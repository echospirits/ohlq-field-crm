// Eventbrite API sync stub. Add EVENTBRITE_TOKEN to .env, then map returned events into EventShift.
// Intended flow: fetch organization events -> filter published/upcoming -> create/update EventShift rows.
export async function fetchEventbriteEvents() {
  const token = process.env.EVENTBRITE_TOKEN;
  if (!token) throw new Error('Missing EVENTBRITE_TOKEN');
  // Fill in org id endpoint once the Eventbrite account is connected.
}
