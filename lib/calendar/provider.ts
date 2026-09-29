import type {
  CalendarChangePage,
  CalendarEventInput,
  CalendarEventResult,
  CalendarListEntry,
  CalendarProviderConnection,
  ExternalCalendarEvent,
} from './types';

export interface CalendarProvider {
  createEvent(connection: CalendarProviderConnection, input: CalendarEventInput): Promise<CalendarEventResult>;
  updateEvent(connection: CalendarProviderConnection, eventId: string, input: CalendarEventInput, expectedEtag?: string | null): Promise<CalendarEventResult>;
  deleteEvent(connection: CalendarProviderConnection, eventId: string): Promise<void>;
  getEvent(connection: CalendarProviderConnection, eventId: string): Promise<ExternalCalendarEvent | null>;
  listChanges(connection: CalendarProviderConnection, syncToken?: string | null, pageToken?: string | null): Promise<CalendarChangePage>;
  listCalendars(connection: CalendarProviderConnection): Promise<CalendarListEntry[]>;
}
