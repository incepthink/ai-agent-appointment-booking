import { Router } from "express";
import { z } from "zod";
import {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  requireAuth,
  requireAdmin,
  generatePassword,
} from "./auth";
import { subscribeAppointments } from "./events";
import {
  DAYS,
  type Day,
  createClinicAccount,
  getClinicByEmail,
  getClinicProfile,
  updateClinic,
} from "./clinics";
import {
  getDoctor,
  getDoctorProfile,
  getDoctorRowByEmail,
  listClinicDoctors,
  updateDoctor,
  setDoctorPassword,
  createDoctorAccount,
} from "./doctors";
import { listAvailableSlots } from "./tools/slots";
import { getMetricsSummary } from "./metrics";
import {
  listClinicAppointments,
  adminCreateAppointment,
  adminRescheduleAppointment,
  adminCancelAppointment,
} from "./admin-appointments";

export const apiRouter = Router();

const hhmm = z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM");
const daysSchema = z
  .array(z.enum(DAYS as unknown as [Day, ...Day[]]))
  .min(1, "Pick at least one open day");

// --- Admin: clinic provisioning (no public signup) ---

// We onboard clinics ourselves: there is no self-signup. This endpoint is gated
// by the admin key (x-admin-key header). The caller supplies the clinic details
// + email; we generate a password and return it once so it can be handed over.
// A doctor to create alongside the clinic. The agent-facing fields (name,
// specialty, bio) are required so the agent can route patients; hours/days/slot
// are optional and inherit the clinic's when omitted.
const newDoctorSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  specialty: z.string().min(1),
  qualification: z.string().min(1, "Qualification is required"),
  bio: z.string().optional(),
  open: hhmm.optional(),
  close: hhmm.optional(),
  days: daysSchema.optional(),
  slotMinutes: z.coerce.number().int().positive().optional(),
});

const provisionSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  tz: z.string().min(1),
  open: hhmm,
  close: hhmm,
  days: daysSchema,
  slotMinutes: z.coerce.number().int().positive().default(30),
  address: z.string().optional(),
  contactPhone: z.string().optional(),
  description: z.string().optional(),
  // At least one doctor — auth is doctor-based, so a clinic with no doctor has
  // no one who can log in.
  doctors: z.array(newDoctorSchema).min(1, "Add at least one doctor"),
});

apiRouter.post("/admin/clinics", requireAdmin, async (req, res) => {
  const parsed = provisionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input." });
  }
  const data = parsed.data;
  if (getClinicByEmail(data.email)) {
    return res.status(409).json({ error: "A clinic with this email already exists." });
  }
  // Reject duplicate doctor emails — both within the batch and against existing rows.
  const seen = new Set<string>();
  for (const d of data.doctors) {
    const key = d.email.trim().toLowerCase();
    if (seen.has(key) || getDoctorRowByEmail(key)) {
      return res.status(409).json({ error: `A doctor with email ${d.email} already exists.` });
    }
    seen.add(key);
  }

  const clinicPassword = generatePassword();
  const clinic = createClinicAccount({
    name: data.name,
    email: data.email,
    passwordHash: await hashPassword(clinicPassword),
    tz: data.tz,
    open: data.open,
    close: data.close,
    days: data.days,
    slotMinutes: data.slotMinutes,
    address: data.address ?? null,
    contactPhone: data.contactPhone ?? null,
    description: data.description ?? null,
  });

  const doctors: { id: number; name: string; email: string; password: string }[] = [];
  for (const d of data.doctors) {
    const password = generatePassword();
    const doctor = createDoctorAccount({
      clinicId: clinic.id,
      clinicCode: clinic.code,
      email: d.email,
      passwordHash: await hashPassword(password),
      name: d.name,
      specialty: d.specialty,
      qualification: d.qualification,
      bio: d.bio ?? null,
      open: d.open ?? clinic.open,
      close: d.close ?? clinic.close,
      days: d.days ?? clinic.days,
      slotMinutes: d.slotMinutes ?? clinic.slotMinutes,
    });
    doctors.push({ id: doctor.id, name: doctor.name, email: doctor.email!, password });
  }
  // Plaintext passwords are returned ONCE — they are not stored or recoverable later.
  res.status(201).json({ clinic, doctors });
});

// --- Auth ---

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

apiRouter.post("/auth/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Email and password are required." });
  }
  // Doctors log in with their own credentials; the clinic comes from the doctor.
  const row = getDoctorRowByEmail(parsed.data.email);
  if (!row || !row.password_hash) {
    return res.status(401).json({ error: "Invalid email or password." });
  }
  const ok = await verifyPassword(parsed.data.password, row.password_hash);
  if (!ok) {
    return res.status(401).json({ error: "Invalid email or password." });
  }
  const token = signToken(row.id);
  res.json({
    token,
    doctor: getDoctorProfile(row.id),
    clinic: getClinicProfile(row.clinic_id),
  });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6, "New password must be at least 6 characters"),
});

apiRouter.post("/auth/change-password", requireAuth, async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input." });
  }
  const profile = getDoctorProfile(req.doctorId!);
  if (!profile?.email) return res.status(404).json({ error: "Account not found." });
  const row = getDoctorRowByEmail(profile.email);
  if (!row || !row.password_hash) {
    return res.status(400).json({ error: "Password change is unavailable for this account." });
  }
  const ok = await verifyPassword(parsed.data.currentPassword, row.password_hash);
  if (!ok) {
    return res.status(401).json({ error: "Current password is incorrect." });
  }
  setDoctorPassword(row.id, await hashPassword(parsed.data.newPassword));
  res.json({ ok: true });
});

// --- Clinic profile / config (authenticated) ---

apiRouter.get("/clinic", requireAuth, (req, res) => {
  const clinic = getClinicProfile(req.clinicId!);
  if (!clinic) return res.status(404).json({ error: "Clinic not found." });
  res.json({ clinic });
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  tz: z.string().min(1).optional(),
  open: hhmm.optional(),
  close: hhmm.optional(),
  days: daysSchema.optional(),
  slotMinutes: z.coerce.number().int().positive().optional(),
  address: z.string().nullable().optional(),
  contactPhone: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});

apiRouter.put("/clinic", requireAuth, (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input." });
  }
  const clinic = updateClinic(req.clinicId!, parsed.data);
  if (!clinic) return res.status(404).json({ error: "Clinic not found." });
  res.json({ clinic });
});

// --- Logged-in doctor: own profile + working hours (authenticated) ---

apiRouter.get("/me", requireAuth, (req, res) => {
  const doctor = getDoctorProfile(req.doctorId!);
  if (!doctor) return res.status(404).json({ error: "Account not found." });
  res.json({ doctor });
});

const updateMeSchema = z.object({
  name: z.string().min(1).optional(),
  specialty: z.string().min(1).optional(),
  qualification: z.string().min(1).optional(),
  bio: z.string().nullable().optional(),
  open: hhmm.optional(),
  close: hhmm.optional(),
  days: daysSchema.optional(),
  slotMinutes: z.coerce.number().int().positive().optional(),
});

apiRouter.put("/me", requireAuth, (req, res) => {
  const parsed = updateMeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input." });
  }
  const doctor = updateDoctor(req.doctorId!, parsed.data);
  if (!doctor) return res.status(404).json({ error: "Account not found." });
  res.json({ doctor });
});

// --- Clinic doctor roster (authenticated) — powers the dashboard filter + booking picker ---

apiRouter.get("/doctors", requireAuth, (req, res) => {
  const doctors = listClinicDoctors(req.clinicId!).map((d) => {
    // email is not on Doctor; pull it from the profile so the Team page can show
    // each doctor's login. getDoctorProfile is keyed by id (cheap, indexed).
    const email = getDoctorProfile(d.id)?.email ?? null;
    return {
      id: d.id,
      code: d.code,
      name: d.name,
      specialty: d.specialty,
      bio: d.bio,
      open: d.open,
      close: d.close,
      days: d.days,
      slotMinutes: d.slotMinutes,
      email,
    };
  });
  res.json({ doctors });
});

// --- Add a doctor to the caller's clinic (authenticated, clinic-scoped) ---
// The system generates a password and returns it ONCE; the new doctor logs in
// and changes it via /auth/change-password.
const addDoctorSchema = newDoctorSchema;

apiRouter.post("/doctors", requireAuth, async (req, res) => {
  const parsed = addDoctorSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input." });
  }
  const data = parsed.data;
  if (getDoctorRowByEmail(data.email)) {
    return res.status(409).json({ error: "A doctor with this email already exists." });
  }
  const clinic = getClinicProfile(req.clinicId!);
  if (!clinic) return res.status(404).json({ error: "Clinic not found." });

  const password = generatePassword();
  const doctor = createDoctorAccount({
    clinicId: clinic.id,
    clinicCode: clinic.code,
    email: data.email,
    passwordHash: await hashPassword(password),
    name: data.name,
    specialty: data.specialty,
    qualification: data.qualification,
    bio: data.bio ?? null,
    open: data.open ?? clinic.open,
    close: data.close ?? clinic.close,
    days: data.days ?? clinic.days,
    slotMinutes: data.slotMinutes ?? clinic.slotMinutes,
  });
  res.status(201).json({ doctor, email: doctor.email, password });
});

// Re-issue a doctor's password (handover, or the doctor lost theirs). Returns the
// new plaintext password ONCE. Scoped to the caller's clinic.
apiRouter.post("/doctors/:id/reset-password", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid doctor id." });
  const doctor = getDoctor(id);
  if (!doctor || doctor.clinicId !== req.clinicId!) {
    return res.status(404).json({ error: "Doctor not found at this clinic." });
  }
  const password = generatePassword();
  setDoctorPassword(id, await hashPassword(password));
  res.json({ email: getDoctorProfile(id)?.email ?? null, password });
});

// --- Agent response-time metrics (authenticated) ---

// Powers the dashboard Insights page. Metrics are system-wide (not clinic-scoped):
// "our average response time" is a property of the agent, and pre-clinic-selection
// turns belong to no clinic. ?days filters the window; "all" / 0 means all-time.
apiRouter.get("/metrics", requireAuth, (req, res) => {
  const raw = req.query.days;
  let days: number | null = 7;
  if (raw === "all" || raw === "0") {
    days = null;
  } else if (typeof raw === "string" && Number.isInteger(Number(raw)) && Number(raw) > 0) {
    days = Number(raw);
  }
  res.json(getMetricsSummary(days));
});

// --- Appointments (authenticated, clinic-scoped) ---

apiRouter.get("/appointments", requireAuth, (req, res) => {
  const { from, to, status, doctor_id } = req.query;
  const doctorId = typeof doctor_id === "string" && Number.isInteger(Number(doctor_id))
    ? Number(doctor_id)
    : undefined;
  const appointments = listClinicAppointments(req.clinicId!, {
    from: typeof from === "string" ? from : undefined,
    to: typeof to === "string" ? to : undefined,
    status: status === "booked" || status === "cancelled" ? status : undefined,
    doctorId,
  });
  res.json({ appointments });
});

// Server-Sent Events: push a notification whenever this clinic's appointments
// change (booked from WhatsApp or the dashboard) so the UI refreshes live.
// EventSource can't send an Authorization header, so the token rides in ?token=.
apiRouter.get("/appointments/stream", (req, res) => {
  const payload = verifyToken(String(req.query.token ?? ""));
  if (!payload) {
    res.status(401).end();
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  res.write(": connected\n\n");

  // Comment pings keep the connection alive through proxies/idle timeouts.
  const doctor = getDoctor(payload.doctorId);
  if (!doctor) {
    res.status(401).end();
    return;
  }
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  const unsubscribe = subscribeAppointments(doctor.clinicId, () => {
    res.write("event: appointments\ndata: {}\n\n");
  });

  req.on("close", () => {
    clearInterval(ping);
    unsubscribe();
  });
});

const createSchema = z.object({
  patient_name: z.string().min(1),
  phone: z.string().min(1),
  start_iso: z.string().min(1),
  reason: z.string().optional(),
  doctor_id: z.coerce.number().int().positive(),
});

apiRouter.post("/appointments", requireAuth, (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input." });
  }
  const result = adminCreateAppointment(req.clinicId!, parsed.data);
  if (!result.ok) {
    return res.status(409).json({ error: result.error, alternatives: result.alternatives });
  }
  res.status(201).json({ appointment: result.appointment });
});

const rescheduleSchema = z.object({ new_start_iso: z.string().min(1) });

apiRouter.patch("/appointments/:id/reschedule", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid appointment id." });
  const parsed = rescheduleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "new_start_iso is required." });
  const result = adminRescheduleAppointment(req.clinicId!, id, parsed.data.new_start_iso);
  if (!result.ok) {
    return res.status(409).json({ error: result.error, alternatives: result.alternatives });
  }
  res.json({ appointment: result.appointment });
});

apiRouter.patch("/appointments/:id/cancel", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid appointment id." });
  const result = adminCancelAppointment(req.clinicId!, id);
  if (!result.ok) return res.status(409).json({ error: result.error });
  res.json({ appointment: result.appointment });
});

// --- Available slots for the booking UI ---

apiRouter.get("/slots", requireAuth, (req, res) => {
  const date = req.query.date;
  if (typeof date !== "string") {
    return res.status(400).json({ error: "date (YYYY-MM-DD) is required." });
  }
  const doctorId = Number(req.query.doctor_id);
  if (!Number.isInteger(doctorId)) {
    return res.status(400).json({ error: "doctor_id is required." });
  }
  const doctor = getDoctor(doctorId);
  if (!doctor || doctor.clinicId !== req.clinicId!) {
    return res.status(404).json({ error: "Doctor not found at this clinic." });
  }
  res.json(listAvailableSlots(doctor, { date }));
});
