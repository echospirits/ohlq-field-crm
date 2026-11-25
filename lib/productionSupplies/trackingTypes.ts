export type TrackingEnvironment = Record<string, string | undefined>;

export class SupplyTrackingError extends Error {
  constructor(message: string, readonly code: string, readonly temporary = false, readonly retryAfterSeconds?: number) { super(message); }
}

export type TrackingReference = { referenceType: string; reference: string; carrier?: string | null; providerTrackingId?: string | null; providerMode?: string | null; timezone?: string | null; returnedAt?: Date | null };

export type NormalizedTrackingObservation = {
  provider: 'EASYPOST' | 'WARD'; providerTrackingId: string; providerMode: 'test' | 'production'; trackingCode: string; carrier: string | null;
  eventKey: string; providerEventAt: Date; eventTimeKnown?: boolean; observedAt: Date; status: string; summary: string; returned: boolean; deliveredAt: Date | null;
  estimate: { source: 'CARRIER'; precision: 'DATE' | 'TIME_WINDOW'; startDate: string; endDate: string | null; timeStart: string | null; timeEnd: string | null; timezone: string } | null;
};
