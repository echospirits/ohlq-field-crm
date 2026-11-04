/** Operational signals are deliberately independent of the statistical forecast. */
export type DeliveryRetrievalStatus = 'SUCCESS' | 'NO_AVAILABILITY' | 'AUTH_FAILED' | 'UNAVAILABLE' | 'INVALID_RESPONSE' | 'NOT_CONFIGURED';

/** A complete, explicitly supplied source calendar; missing slots are not closures. */
export type OperatingCalendar = {
  coveredFrom: string;
  coveredThrough: string;
  /** JavaScript weekday convention: Sunday = 0, Monday = 1, Saturday = 6. */
  openWeekdays: readonly number[];
  closedDates: readonly string[];
};

export type OpenDockLocationConfig = {
  market: string;
  locationCode: string;
  locationName: string;
  warehouseId: string;
  loadTypeId: string;
  timezone: string;
  calendar?: OperatingCalendar;
};

export type DeliveryAvailabilityResult = {
  market: string;
  locationCode: string;
  locationName: string;
  warehouseId: string;
  loadTypeId: string;
  timezone: string;
  observedAt: string;
  source: 'OPENDOCK';
  status: DeliveryRetrievalStatus;
  earliestAvailableAt: string | null;
  calendarDays: number | null;
  businessDays: number | null;
  businessDayMethod: 'SOURCE_OPERATING_CALENDAR' | null;
  /** End of the successfully searched time range; not an unlimited availability claim. */
  checkedThrough: string | null;
  diagnosticCode: string | null;
};

export type DeliveryHistoryObservation = {
  observedAt: string | Date;
  calendarDays: number | null;
  status: DeliveryRetrievalStatus;
};

export type DeliveryBaseline = {
  stage: 'PRIOR_YEAR_SEASONAL' | 'NEARBY_CALENDAR_PERIOD' | 'TRAILING_90_DAYS' | 'INSUFFICIENT_HISTORY';
  classification: 'Less than average' | 'About average' | 'More than average' | null;
  typicalDays: number | null;
  sampleDays: number;
  toleranceDays: number | null;
};
