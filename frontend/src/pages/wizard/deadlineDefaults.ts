/**
 * Calculate default deadlines based on session date.
 *
 * Conventions:
 * - PPT email deadline: session day 09:00
 * - PPT email late deadline: session day 18:00
 * - Post tasks deadline (review, PPT board, feedback): next Wednesday 21:59
 */
export function calcDefaultDeadlines(sessionDate: string) {
    // PPT email: session day 09:00
    const pptEmail = `${sessionDate}T09:00`;

    // PPT email late: session day 18:00
    const pptEmailLate = `${sessionDate}T18:00`;

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
