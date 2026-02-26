/**
 * Calculate default deadlines based on session date.
 *
 * Conventions:
 * - PPT email deadline: day before session 21:59
 * - PPT email late deadline: session day 09:59
 * - Post tasks deadline (review, PPT board, feedback): next Wednesday 21:59
 */
export function calcDefaultDeadlines(sessionDate: string) {
    // PPT email: day before session 21:59
    const prev = new Date(sessionDate + "T00:00:00");
    prev.setDate(prev.getDate() - 1);
    const py = prev.getFullYear();
    const pm = String(prev.getMonth() + 1).padStart(2, "0");
    const pd = String(prev.getDate()).padStart(2, "0");
    const pptEmail = `${py}-${pm}-${pd}T21:59`;

    // PPT email late: session day 09:59
    const pptEmailLate = `${sessionDate}T09:59`;

    // Post: next Wednesday (after session date) at 21:59
    const d = new Date(sessionDate + "T00:00:00");
    const dayOfWeek = d.getDay(); // 0=Sun..6=Sat
    // Days until next Wednesday (3)
    let daysUntilWed = (3 - dayOfWeek + 7) % 7;
    if (daysUntilWed === 0) daysUntilWed = 7; // if session is on Wednesday, next week
    d.setDate(d.getDate() + daysUntilWed);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const post = `${yyyy}-${mm}-${dd}T21:59`;

    return { pptEmail, pptEmailLate, post };
}
