'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { ActionForm, type ActionResult } from '../components/ActionForm';
import { SubmitButton } from '../components/SubmitButton';
import { TargetAccountMarker } from '../components/TargetAccountMarker';
import { useDialogFocus } from '../components/useDialogFocus';
import { addDaysToDateInputValue, formatDateOnlyInputValue, formatTimeMinutes, formatTimeMinutesInput } from '../../lib/dateTime';
import { getOperatingHoursConflict, type OperatingHoursEntry } from '../../lib/operatingHours';
import {
  addSchedulerDays,
  getCurrentSchedulerDate,
  getSchedulerDayItems,
  getSchedulerPlanningTray,
  getSchedulerTimedPlacements,
  getSchedulerWeekDates,
  type SchedulerWorklistItem,
} from '../../lib/myDayWeekScheduler';
import type { SchedulerActionResult } from './actions';

const GRID_START_MINUTES = 7 * 60;
const GRID_END_MINUTES = 20 * 60;
const GRID_SLOT_MINUTES = 30;
const GRID_SLOT_HEIGHT = 38;
const gridSlots = Array.from({ length: (GRID_END_MINUTES - GRID_START_MINUTES) / GRID_SLOT_MINUTES }, (_, index) => GRID_START_MINUTES + index * GRID_SLOT_MINUTES);

const longDayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' });
const shortDayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' });
const monthRangeFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
const weekdayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' });

type WorklistLocation = { id: string; name: string; type: 'agency' | 'wholesale'; href: string; businessHours: OperatingHoursEntry[] | null } | null;
type SchedulerItem = SchedulerWorklistItem & {
  title: string;
  detail: string | null;
  updatedAt: string;
  category: string;
  agencyId: string | null;
  wholesaleAccountId: string | null;
  salesOpportunityId: string | null;
  agencyProductIntelligenceId: string | null;
  productItemCode: string | null;
  productName: string | null;
  assignedToUserId: string | null;
  assignedTo: string | null;
  isTargeting: boolean;
  location: WorklistLocation;
};
type AccountSearchResult = { id: string; name: string; city: string | null; identifier: string };
type TeamMember = { id: string; name: string };

type WorklistSchedulerProps = {
  view: 'day' | 'week';
  anchorDate: string;
  items: SchedulerItem[];
  currentUserId: string;
  users: TeamMember[];
  updateAction: (formData: FormData) => Promise<SchedulerActionResult>;
  completeAction: (formData: FormData) => Promise<ActionResult>;
  createAction: (formData: FormData) => Promise<SchedulerActionResult>;
};

const dateAtUtcMidnight = (date: string) => new Date(`${date}T12:00:00.000Z`);
const formatDay = (date: string) => longDayFormatter.format(dateAtUtcMidnight(date));
const formatShortDay = (date: string) => shortDayFormatter.format(dateAtUtcMidnight(date));
const formatMonthRange = (date: string) => monthRangeFormatter.format(dateAtUtcMidnight(date));
const timeLabel = (minutes: number) => formatTimeMinutes(minutes);
const statusLabel = (status: string) => status === 'IN_PROGRESS' ? 'In progress' : 'Open';
const scheduleHref = (view: 'day' | 'week', date: string) => `/?view=${view}&date=${date}`;
const LEGACY_ASSIGNMENT = '__legacy_assignment__';

function SchedulerAccountLabel({ item, fallback }: { item: SchedulerItem; fallback?: string }) {
  return <>{item.location?.name ?? fallback ?? item.category.toLowerCase()}{item.isTargeting && item.location ? <> · <TargetAccountMarker /></> : null}</>;
}

const getTaskVisitHref = (item: SchedulerItem, returnTo: string) => {
  if (!item.location) return null;
  const params = new URLSearchParams({
    type: item.location.type,
    worklistItemId: item.id,
    sourceType: 'WORKLIST',
    sourceLabel: item.title,
    returnTo,
  });
  if (item.location.type === 'agency') params.set('agencyId', item.location.id);
  else params.set('wholesaleAccountId', item.location.id);
  if (item.salesOpportunityId) params.set('opportunityId', item.salesOpportunityId);
  if (item.agencyProductIntelligenceId) params.set('agencyProductIntelligenceId', item.agencyProductIntelligenceId);
  if (item.productItemCode) params.set('productItemCode', item.productItemCode);
  if (item.productName) params.set('productName', item.productName);
  return `/visits/new?${params.toString()}`;
};

const getNextFriday = (date: string) => {
  const weekday = dateAtUtcMidnight(date).getUTCDay();
  return addDaysToDateInputValue(date, (5 - weekday + 7) % 7);
};

const getNextWeekday = (date: string) => {
  const weekday = dateAtUtcMidnight(date).getUTCDay();
  return addDaysToDateInputValue(date, ((8 - weekday) % 7) || 7);
};

export function WorklistScheduler({ view, anchorDate, items, currentUserId, users, updateAction, completeAction, createAction }: WorklistSchedulerProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);
  const scheduleInFlightRef = useRef(false);
  const [mobileDate, setMobileDate] = useState(anchorDate);
  const [selectedItem, setSelectedItem] = useState<SchedulerItem | null>(null);
  const [createContext, setCreateContext] = useState<{ date: string; time: number | null } | null>(null);
  const [createMode, setCreateMode] = useState<'choose' | 'existing' | 'new'>('choose');
  const [createDate, setCreateDate] = useState(anchorDate);
  const [createTime, setCreateTime] = useState('');
  const [createSubmissionKey, setCreateSubmissionKey] = useState('');
  const [createCategory, setCreateCategory] = useState('GENERAL');
  const [accountSearch, setAccountSearch] = useState('');
  const [accountResults, setAccountResults] = useState<AccountSearchResult[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<AccountSearchResult | null>(null);
  const [accountSearching, setAccountSearching] = useState(false);
  const [accountSearchError, setAccountSearchError] = useState('');
  const [existingSearch, setExistingSearch] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [assignmentChoice, setAssignmentChoice] = useState('');
  const [assignmentChanged, setAssignmentChanged] = useState(false);
  const [specificTime, setSpecificTime] = useState(false);
  const [savingTaskId, setSavingTaskId] = useState('');
  const [feedback, setFeedback] = useState('');

  const weekDates = useMemo(() => getSchedulerWeekDates(anchorDate), [anchorDate]);
  const tray = useMemo(() => getSchedulerPlanningTray(items, view === 'day' ? anchorDate : weekDates[0]), [anchorDate, items, view, weekDates]);
  const closeDialogs = useCallback(() => {
    setSelectedItem(null);
    setCreateContext(null);
    setFeedback('');
  }, []);
  useDialogFocus(dialogRef, Boolean(selectedItem || createContext), closeDialogs);

  useEffect(() => setMobileDate(anchorDate), [anchorDate]);

  useEffect(() => {
    if (!createContext || createMode !== 'new' || selectedAccount || (createCategory !== 'AGENCY' && createCategory !== 'WHOLESALE') || accountSearch.trim().length < 2) {
      setAccountResults([]);
      setAccountSearching(false);
      setAccountSearchError('');
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setAccountSearching(true);
      setAccountSearchError('');
      try {
        const type = createCategory === 'AGENCY' ? 'agency' : 'wholesale';
        const response = await fetch(`/api/visits/account-search?${new URLSearchParams({ q: accountSearch.trim(), type })}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Account search failed: ${response.status}`);
        const data = await response.json() as { results: Array<{ id: string; name: string; city: string | null; agencyId?: string; licenseeId?: string }> };
        setAccountResults(data.results.map((account) => ({
          id: account.id,
          name: account.name,
          city: account.city,
          identifier: createCategory === 'AGENCY' ? account.agencyId ?? '' : account.licenseeId ?? '',
        })));
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error('Scheduler account search failed', error);
        setAccountSearchError('Account search is unavailable. Try again.');
      } finally {
        if (!controller.signal.aborted) setAccountSearching(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [accountSearch, createCategory, createContext, createMode, selectedAccount]);

  const refreshAfterSave = () => {
    closeDialogs();
    router.refresh();
  };

  const refreshAfterConflict = (message: string, shouldRefresh: boolean) => {
    if (!shouldRefresh) return;
    closeDialogs();
    setFeedback(message);
    router.refresh();
  };

  const openAdd = (date: string, time: number | null) => {
    setSelectedItem(null);
    setFeedback('');
    setCreateContext({ date, time });
    setCreateMode('choose');
    setCreateDate(date);
    setCreateTime(time === null ? '' : formatTimeMinutesInput(time));
    setCreateSubmissionKey(crypto.randomUUID());
    setCreateCategory('GENERAL');
    setSelectedAccount(null);
    setAccountSearch('');
    setExistingSearch('');
  };

  const openEdit = (item: SchedulerItem) => {
    setCreateContext(null);
    setFeedback('');
    setSelectedDate(item.dueDate ?? '');
    setSelectedTime(!item.dueDate || item.dueTimeMinutes === null ? '' : formatTimeMinutesInput(item.dueTimeMinutes));
    setSpecificTime(Boolean(item.dueDate && item.dueTimeMinutes !== null));
    setAssignmentChoice(item.assignedToUserId ?? (item.assignedTo ? LEGACY_ASSIGNMENT : ''));
    setAssignmentChanged(false);
    setSelectedItem(item);
  };

  const startDrag = (event: DragEvent<HTMLButtonElement>, item: SchedulerItem) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', item.id);
  };

  const scheduleDrop = async (event: DragEvent<HTMLDivElement>, date: string) => {
    event.preventDefault();
    if (scheduleInFlightRef.current) return;
    const id = event.dataTransfer.getData('text/plain');
    const item = items.find((candidate) => candidate.id === id);
    if (!item) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const slot = Math.max(0, Math.min(gridSlots.length - 1, Math.floor((event.clientY - bounds.top) / GRID_SLOT_HEIGHT)));
    const minutes = GRID_START_MINUTES + slot * GRID_SLOT_MINUTES;
    if (item.dueDate === date && item.dueTimeMinutes === minutes) return;

    scheduleInFlightRef.current = true;
    setSavingTaskId(item.id);
    setFeedback('Saving schedule…');
    const data = new FormData();
    data.set('id', item.id);
    data.set('expectedUpdatedAt', item.updatedAt);
    data.set('dueDate', date);
    data.set('dueTime', formatTimeMinutesInput(minutes));
    try {
      const result = await updateAction(data);
      if ('error' in result) {
        setFeedback(result.error);
        if (result.refresh) router.refresh();
      }
      else {
        setFeedback('Schedule saved.');
        router.refresh();
      }
    } catch (error) {
      console.error('Worklist drag schedule failed', error);
      setFeedback('Could not confirm the save. Refresh the schedule and check the task before trying again.');
      router.refresh();
    } finally {
      scheduleInFlightRef.current = false;
      setSavingTaskId('');
    }
  };

  const scheduleExisting = async (item: SchedulerItem) => {
    if (!createContext || scheduleInFlightRef.current) return;
    scheduleInFlightRef.current = true;
    setSavingTaskId(item.id);
    setFeedback('Saving schedule…');
    const data = new FormData();
    data.set('id', item.id);
    data.set('expectedUpdatedAt', item.updatedAt);
    data.set('dueDate', createDate);
    data.set('dueTime', createTime);
    try {
      const result = await updateAction(data);
      if ('error' in result) {
        setFeedback(result.error);
        if (result.refresh) refreshAfterConflict(result.error, true);
      }
      else {
        closeDialogs();
        setFeedback('Existing task scheduled.');
        router.refresh();
      }
    } catch (error) {
      console.error('Existing Worklist schedule failed', error);
      refreshAfterConflict('Could not confirm the save. Refresh the schedule and check the task before trying again.', true);
    } finally {
      scheduleInFlightRef.current = false;
      setSavingTaskId('');
    }
  };

  const isInGrid = (item: SchedulerItem) => item.dueTimeMinutes !== null && item.dueTimeMinutes >= GRID_START_MINUTES && item.dueTimeMinutes < GRID_END_MINUTES;
  const currentDate = getCurrentSchedulerDate();
  const visibleTray = view === 'day' ? getSchedulerPlanningTray(items, anchorDate) : tray;
  const addButtonDate = view === 'week' ? mobileDate : anchorDate;

  const renderEvent = (item: SchedulerItem, lane: number, laneCount: number, overlapCount: number) => {
    const minute = item.dueTimeMinutes ?? GRID_START_MINUTES;
    const top = ((minute - GRID_START_MINUTES) / GRID_SLOT_MINUTES) * GRID_SLOT_HEIGHT;
    const width = 100 / laneCount;
    const style = { top: `${top}px`, left: `${width * lane}%`, width: `${width}%`, height: `${GRID_SLOT_HEIGHT - 3}px` } as CSSProperties;
    const hoursConflict = getOperatingHoursConflict({ accountType: item.location?.type, schedule: item.location?.businessHours, date: item.dueDate, startMinutes: item.dueTimeMinutes });
    const overlapLabel = overlapCount > 1
      ? ` Overlaps ${overlapCount - 1} other scheduled item${overlapCount === 2 ? '' : 's'}.`
      : '';
    return <button
      aria-label={`${timeLabel(minute)}: ${item.title}${item.location ? `, ${item.location.name}${item.isTargeting ? ', Target account' : ''}` : ''}.${hoursConflict ? ` ${hoursConflict.label}.` : ''}${overlapLabel} Open task actions`}
      className={`scheduler-event${overlapCount > 1 ? ' scheduler-event-overlapping' : ''}${hoursConflict ? ` scheduler-event-hours-${hoursConflict.accountType}` : ''}`}
      draggable
      key={item.id}
      onClick={() => openEdit(item)}
      onDragStart={(event) => startDrag(event, item)}
      style={style}
      title={hoursConflict?.label}
      type="button"
    >
      {overlapCount > 1 ? <span aria-hidden="true" className="scheduler-event-overlap-badge" title={overlapLabel.trim()}>{overlapCount}×</span> : null}
      <span className="scheduler-event-time">{timeLabel(minute)}</span>
      <strong>{item.title}</strong>
      {item.location ? <span className="scheduler-event-location"><span className="scheduler-event-account-name"><SchedulerAccountLabel item={item} /></span>{hoursConflict ? <small className={`scheduler-hours-indicator scheduler-hours-indicator--${hoursConflict.accountType}`}>Outside hours</small> : null}</span> : null}
    </button>;
  };

  const renderAnytimeBoard = (dates: string[]) => <div className="scheduler-anytime-board" style={{ gridTemplateColumns: `64px repeat(${dates.length}, minmax(0, 1fr))` }}>
    <strong className="scheduler-anytime-heading">Anytime</strong>
    {dates.map((date) => {
      const anytime = getSchedulerDayItems(items, date).anytime;
      return <div className="scheduler-anytime-day" key={date}>
        {anytime.map((item) => <button
          className="scheduler-anytime-row"
          draggable
          key={item.id}
          onClick={() => openEdit(item)}
          onDragStart={(event) => startDrag(event, item)}
          type="button"
        ><strong>{item.title}</strong><span><SchedulerAccountLabel item={item} /></span></button>)}
        <button aria-label={`Add anytime work ${formatDay(date)}`} className="secondary scheduler-add-anytime" onClick={() => openAdd(date, null)} type="button">Add anytime</button>
      </div>;
    })}
  </div>;

  const renderCalendar = (dates: string[], className: string) => <div className={`scheduler-calendar ${className}`}>
    <div className="scheduler-day-headings" style={{ gridTemplateColumns: `64px repeat(${dates.length}, minmax(0, 1fr))` }}>
      <div aria-hidden="true" />
      {dates.map((date) => {
        const dateItems = getSchedulerDayItems(items, date);
        return <div className="scheduler-day-heading" key={date}>
          <strong>{view === 'day' ? formatDay(date) : weekdayFormatter.format(dateAtUtcMidnight(date))}</strong>
          {view === 'week' ? <span>{formatMonthRange(date)}</span> : null}
          <small>{dateItems.timed.length + dateItems.anytime.length} scheduled</small>
        </div>;
      })}
    </div>
    <div className="scheduler-calendar-scroll">
      <div className="scheduler-calendar-body" style={{ gridTemplateColumns: `64px repeat(${dates.length}, minmax(0, 1fr))` }}>
        <div aria-hidden="true" className="scheduler-time-labels">
          {gridSlots.filter((minute) => minute % 60 === 0).map((minute) => <span key={minute} style={{ top: `${((minute - GRID_START_MINUTES) / GRID_SLOT_MINUTES) * GRID_SLOT_HEIGHT - 8}px` }}>{timeLabel(minute)}</span>)}
        </div>
        {dates.map((date) => {
          const day = getSchedulerDayItems(items, date);
          const timed = getSchedulerTimedPlacements(items, date);
          const inGrid = timed.filter(({ item }) => isInGrid(item));
          const outside = timed.filter(({ item }) => !isInGrid(item));
          return <div
            aria-label={`Schedule for ${formatDay(date)}`}
            className="scheduler-day-column"
            key={date}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }}
            onDrop={(event) => { void scheduleDrop(event, date); }}
            style={{ minHeight: `${gridSlots.length * GRID_SLOT_HEIGHT}px` }}
          >
            {gridSlots.map((minute) => <button
              aria-label={`Add work ${formatDay(date)} at ${timeLabel(minute)}`}
              className="scheduler-time-slot"
              key={minute}
              onClick={() => openAdd(date, minute)}
              style={{ top: `${((minute - GRID_START_MINUTES) / GRID_SLOT_MINUTES) * GRID_SLOT_HEIGHT}px`, height: `${GRID_SLOT_HEIGHT}px` }}
              type="button"
            ><span className="scheduler-slot-add">Add</span></button>)}
            {inGrid.map(({ item, lane, laneCount, overlapCount }) => renderEvent(item, lane, laneCount, overlapCount))}
            {outside.length > 0 ? <div className="scheduler-outside-events">
              <strong>Outside planning hours</strong>
              {outside.map(({ item, overlapCount }) => {
                const hoursConflict = getOperatingHoursConflict({ accountType: item.location?.type, schedule: item.location?.businessHours, date: item.dueDate, startMinutes: item.dueTimeMinutes });
                return <button aria-label={`${timeLabel(item.dueTimeMinutes!)}: ${item.title}${hoursConflict ? `. ${hoursConflict.label}.` : ''} Open task actions`} className={`scheduler-anytime-row${hoursConflict ? ` scheduler-anytime-hours-${hoursConflict.accountType}` : ''}`} draggable key={item.id} onClick={() => openEdit(item)} onDragStart={(event) => startDrag(event, item)} title={hoursConflict?.label} type="button">
                <span>{timeLabel(item.dueTimeMinutes!)}</span><strong>{item.title}</strong>
                {item.location ? <small>{item.location.name}</small> : null}
                {hoursConflict ? <small className="scheduler-hours-indicator">{hoursConflict.label}</small> : null}
                {overlapCount > 1 ? <small className="scheduler-overlap-indicator">Overlaps {overlapCount - 1} other scheduled item{overlapCount === 2 ? '' : 's'}</small> : null}
              </button>;
              })}
            </div> : null}
          </div>;
        })}
      </div>
      {view === 'week' ? renderAnytimeBoard(dates) : null}
    </div>
  </div>;

  const renderMobileDay = (date: string) => {
    const day = getSchedulerDayItems(items, date);
    const timed = getSchedulerTimedPlacements(items, date);
    const outside = timed.filter(({ item }) => !isInGrid(item));
    return <div className="scheduler-mobile-day" key={date}>
      <h2>{formatDay(date)}</h2>
      {day.timed.length > 0 ? <ol className="scheduler-mobile-timeline">
        {timed.map(({ item, overlapCount }) => {
          const hoursConflict = getOperatingHoursConflict({ accountType: item.location?.type, schedule: item.location?.businessHours, date: item.dueDate, startMinutes: item.dueTimeMinutes });
          return <li key={item.id}>
          <span className="scheduler-mobile-time">{timeLabel(item.dueTimeMinutes!)}</span>
          <button aria-label={`${item.title}${hoursConflict ? `. ${hoursConflict.label}.` : ''} Open task actions`} className={`scheduler-mobile-task${hoursConflict ? ` scheduler-mobile-hours-${hoursConflict.accountType}` : ''}`} onClick={() => openEdit(item)} title={hoursConflict?.label} type="button">
            <strong>{item.title}</strong>
            <span><SchedulerAccountLabel item={item} /></span>
            {hoursConflict ? <small className="scheduler-hours-indicator">{hoursConflict.label}</small> : null}
            {overlapCount > 1 ? <small className="scheduler-overlap-indicator">Overlaps {overlapCount - 1} other scheduled item{overlapCount === 2 ? '' : 's'}</small> : null}
            <small>{statusLabel(item.status)}</small>
          </button>
        </li>;
        })}
      </ol> : <p className="muted scheduler-day-empty">No timed work scheduled for this day.</p>}
      {outside.length > 0 ? <p className="muted">Includes {outside.length} item{outside.length === 1 ? '' : 's'} outside 7:00 AM–8:00 PM.</p> : null}
      <section className="scheduler-anytime" aria-labelledby={`anytime-${date}`}>
        <div className="section-heading"><h3 id={`anytime-${date}`}>Anytime</h3><span className="pill">{day.anytime.length}</span></div>
        {day.anytime.length > 0 ? day.anytime.map((item) => <button className="scheduler-anytime-row" key={item.id} onClick={() => openEdit(item)} type="button">
          <strong>{item.title}</strong><span><SchedulerAccountLabel item={item} /></span>
        </button>) : <p className="muted">No date-only tasks.</p>}
        <button className="btn secondary scheduler-add-anytime" onClick={() => openAdd(date, null)} type="button">Add anytime work</button>
      </section>
    </div>;
  };

  const filteredExisting = useMemo(() => {
    const query = existingSearch.trim().toLowerCase();
    return items.filter((item) => {
      if (item.status !== 'OPEN' && item.status !== 'IN_PROGRESS') return false;
      if (!query) return true;
      return [item.title, item.detail ?? '', item.location?.name ?? ''].some((value) => value.toLowerCase().includes(query));
    });
  }, [existingSearch, items]);

  const weekLabel = `${formatMonthRange(weekDates[0])} – ${formatMonthRange(weekDates[6])}`;
  const feedbackIsError = Boolean(feedback) && !['Saving schedule…', 'Schedule saved.', 'Existing task scheduled.'].includes(feedback);
  const previousDate = addSchedulerDays(anchorDate, view === 'day' ? -1 : -7);
  const nextDate = addSchedulerDays(anchorDate, view === 'day' ? 1 : 7);

  return <section className={`worklist-scheduler worklist-scheduler-${view}`} aria-labelledby="scheduler-title">
    <nav aria-label="Schedule view" className="view-switcher scheduler-view-tabs">
      <Link aria-current={view === 'day' ? 'page' : undefined} href={scheduleHref('day', view === 'week' ? mobileDate : anchorDate)}>Day</Link>
      <Link aria-current={view === 'week' ? 'page' : undefined} href={scheduleHref('week', anchorDate)}>Week</Link>
    </nav>
    <header className="scheduler-header">
      <div>
        <span className="page-eyebrow">My work</span>
        <h2 id="scheduler-title">{view === 'day' ? formatDay(anchorDate) : weekLabel}</h2>
        <p className="muted">{view === 'day' ? 'Schedule your day. Date-only work stays in Anytime.' : 'Drag work to schedule it. Tap a day on mobile to see its timeline.'}</p>
      </div>
      <div className="scheduler-header-actions">
        <nav className="scheduler-date-nav" aria-label={view === 'day' ? 'Choose day' : 'Choose week'}>
          <Link aria-label={view === 'day' ? 'Previous day' : 'Previous week'} href={scheduleHref(view, previousDate)}>‹</Link>
          <Link href={scheduleHref(view, currentDate)}>Today</Link>
          <Link aria-label={view === 'day' ? 'Next day' : 'Next week'} href={scheduleHref(view, nextDate)}>›</Link>
        </nav>
        <button className="btn primary" onClick={() => openAdd(addButtonDate, null)} type="button">Add work</button>
      </div>
    </header>

    {view === 'week' ? <nav className="scheduler-mobile-days" aria-label="Choose a day">
      {weekDates.map((date) => {
        const day = getSchedulerDayItems(items, date);
        return <button aria-current={mobileDate === date ? 'date' : undefined} className={mobileDate === date ? 'selected' : ''} key={date} onClick={() => setMobileDate(date)} type="button">
          <span>{weekdayFormatter.format(dateAtUtcMidnight(date))}</span>
          <strong>{new Date(`${date}T00:00:00.000Z`).getUTCDate()}</strong>
          <small>{day.timed.length + day.anytime.length}</small>
        </button>;
      })}
    </nav> : null}

    <div className="scheduler-desktop">
      {view === 'day' ? <div className="scheduler-day-layout">
        {renderCalendar([anchorDate], 'scheduler-calendar-day')}
        <aside className="scheduler-tray" aria-labelledby="scheduler-tray-title">
          <div className="section-heading"><h3 id="scheduler-tray-title">To Do Today</h3><span className="pill">{visibleTray.length + getSchedulerDayItems(items, anchorDate).anytime.length}</span></div>
          <section className="scheduler-tray-subsection" aria-labelledby="scheduler-today-anytime-title">
            <div className="section-heading"><h4 id="scheduler-today-anytime-title">Anytime today</h4><span className="pill">{getSchedulerDayItems(items, anchorDate).anytime.length}</span></div>
            {getSchedulerDayItems(items, anchorDate).anytime.length ? getSchedulerDayItems(items, anchorDate).anytime.map((item) => <button className="scheduler-tray-item" draggable key={item.id} onClick={() => openEdit(item)} onDragStart={(event) => startDrag(event, item)} type="button">
              <strong>{item.title}</strong><span><SchedulerAccountLabel item={item} /></span>
            </button>) : <p className="muted">No date-only tasks.</p>}
            <button className="secondary scheduler-tray-add" onClick={() => openAdd(anchorDate, null)} type="button">Add anytime work</button>
          </section>
          <section className="scheduler-tray-subsection" aria-labelledby="scheduler-overdue-title">
            <div className="section-heading"><h4 id="scheduler-overdue-title">Overdue or undated</h4><span className="pill">{visibleTray.length}</span></div>
            <p className="muted">Recent overdue work (past 30 days) and tasks with no date.</p>
          {visibleTray.length ? visibleTray.map((item) => <button className="scheduler-tray-item" draggable key={item.id} onClick={() => openEdit(item)} onDragStart={(event) => startDrag(event, item)} type="button">
            <strong>{item.title}</strong><span><SchedulerAccountLabel item={item} /></span>
            <small>{item.dueDate ? `Overdue · ${formatDateOnlyInputValue(new Date(`${item.dueDate}T00:00:00.000Z`))}` : 'No date set'}</small>
          </button>) : <p className="muted">No overdue or undated work.</p>}
          </section>
        </aside>
      </div> : <>
        {renderCalendar(weekDates, 'scheduler-calendar-week')}
        <section className="scheduler-tray scheduler-week-tray" aria-labelledby="scheduler-week-tray-title">
          <div className="section-heading"><h3 id="scheduler-week-tray-title">Unscheduled / Overdue</h3><span className="pill">{visibleTray.length}</span></div>
          <p className="muted">Undated tasks and overdue work from the past 30 days, assigned to you.</p>
          {visibleTray.length ? visibleTray.map((item) => <button className="scheduler-tray-item" draggable key={item.id} onClick={() => openEdit(item)} onDragStart={(event) => startDrag(event, item)} type="button">
            <strong>{item.title}</strong><span><SchedulerAccountLabel item={item} /></span>
            <small>{item.dueDate ? `Overdue · ${formatDateOnlyInputValue(new Date(`${item.dueDate}T00:00:00.000Z`))}` : 'No date set'}</small>
          </button>) : <p className="muted">No overdue or undated work.</p>}
        </section>
      </>}
    </div>

    <div className="scheduler-mobile">
      {renderMobileDay(view === 'day' ? anchorDate : mobileDate)}
      <details className="scheduler-mobile-tray">
        <summary>Unscheduled / recent overdue <span className="pill">{visibleTray.length}</span></summary>
        <div>
          <p className="muted">Overdue work from the past 30 days and undated tasks assigned to you.</p>
          {visibleTray.length ? visibleTray.map((item) => <button className="scheduler-tray-item" key={item.id} onClick={() => openEdit(item)} type="button">
            <strong>{item.title}</strong><span><SchedulerAccountLabel item={item} /></span>
            <small>{item.dueDate ? `Overdue · ${formatDateOnlyInputValue(new Date(`${item.dueDate}T00:00:00.000Z`))}` : 'No date set'}</small>
          </button>) : <p className="muted">No overdue or undated work.</p>}
        </div>
      </details>
    </div>

    <p aria-live="polite" className={feedback ? `scheduler-feedback${feedbackIsError ? ' scheduler-feedback-error' : ''}` : 'visually-hidden'} role={feedbackIsError ? 'alert' : 'status'}>{feedback}</p>
    {savingTaskId ? <p className="visually-hidden" role="status">Saving task schedule.</p> : null}

    {selectedItem ? <div aria-labelledby={`scheduler-item-${selectedItem.id}`} aria-modal="true" className="app-modal contextual-action-modal" role="dialog">
      <button aria-label="Close task actions" className="app-modal-backdrop" onClick={closeDialogs} type="button" />
      <div className="app-modal-panel contextual-action-sheet scheduler-action-sheet" ref={dialogRef}>
        <div className="app-modal-header"><div><span className="page-eyebrow">{statusLabel(selectedItem.status)}</span><h2 id={`scheduler-item-${selectedItem.id}`}>{selectedItem.title}</h2></div><button aria-label="Close" className="app-modal-close secondary" onClick={closeDialogs} type="button">Close</button></div>
        {selectedItem.location ? <p className="scheduler-account-context"><span><Link href={selectedItem.location.href}>{selectedItem.location.name}</Link>{selectedItem.isTargeting ? <> · <TargetAccountMarker /></> : null}</span><span>{selectedItem.location.type === 'wholesale' ? 'Wholesale account' : 'Agency'}</span></p> : <p className="muted">No account linked to this task.</p>}
        {selectedItem.detail ? <p className="scheduler-task-detail">{selectedItem.detail}</p> : null}
        <ActionForm action={updateAction as (data: FormData) => Promise<ActionResult>} className="scheduler-edit-form" onError={refreshAfterConflict} onSuccess={refreshAfterSave}>
          <input name="id" type="hidden" value={selectedItem.id} />
          <input name="expectedUpdatedAt" type="hidden" value={selectedItem.updatedAt} />
          <label>Scheduled date <span className="optional-label">Optional</span><input name="dueDate" onChange={(event) => { setSelectedDate(event.target.value); if (!event.target.value) { setSelectedTime(''); setSpecificTime(false); } }} type="date" value={selectedDate} /></label>
          <div className="scheduler-shortcuts" aria-label="Reschedule date">
            <button onClick={() => setSelectedDate(currentDate)} type="button">Today</button>
            <button onClick={() => setSelectedDate(addDaysToDateInputValue(currentDate, 1))} type="button">Tomorrow</button>
            <button onClick={() => setSelectedDate(getNextFriday(currentDate))} type="button">Friday</button>
            <button onClick={() => setSelectedDate(getNextWeekday(currentDate))} type="button">Next week</button>
          </div>
          <fieldset className="scheduler-time-options" disabled={!selectedDate}><legend>Time</legend>
            <div className="scheduler-shortcuts">
              <button aria-pressed={!specificTime && !selectedTime} onClick={() => { setSelectedTime(''); setSpecificTime(false); }} type="button">Anytime</button>
              <button aria-pressed={selectedTime === '09:00'} onClick={() => { setSelectedTime('09:00'); setSpecificTime(false); }} type="button">Morning</button>
              <button aria-pressed={selectedTime === '14:00'} onClick={() => { setSelectedTime('14:00'); setSpecificTime(false); }} type="button">Afternoon</button>
              <button aria-pressed={specificTime} onClick={() => setSpecificTime(true)} type="button">Specific time</button>
            </div>
            {specificTime ? <label>Start time<input name="dueTime" onChange={(event) => setSelectedTime(event.target.value)} required={Boolean(selectedDate)} type="time" value={selectedTime} /></label> : <input name="dueTime" type="hidden" value={selectedTime} />}
          </fieldset>
          {!selectedDate ? <p className="muted">Choose a date before setting a time.</p> : null}
          <label>Assigned to<select onChange={(event) => { setAssignmentChoice(event.target.value); setAssignmentChanged(true); }} value={assignmentChoice}>
            <option value="">Unassigned</option>
            {selectedItem.assignedToUserId ? null : selectedItem.assignedTo ? <option disabled value={LEGACY_ASSIGNMENT}>Legacy assignment: {selectedItem.assignedTo}</option> : null}
            {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
          </select></label>
          {assignmentChanged ? <input name="assignedToUserId" type="hidden" value={assignmentChoice === LEGACY_ASSIGNMENT ? '' : assignmentChoice} /> : null}
          <SubmitButton type="submit">Save schedule</SubmitButton>
        </ActionForm>
        <div className="scheduler-context-actions">
          {selectedItem.location ? <Link className="btn secondary" href={selectedItem.location.href}>Open account</Link> : null}
          {getTaskVisitHref(selectedItem, scheduleHref(view, anchorDate)) ? <Link className="btn secondary" href={getTaskVisitHref(selectedItem, scheduleHref(view, anchorDate))!}>Log visit</Link> : null}
          <Link className="btn secondary" href={`/alerts#worklist-${selectedItem.id}`}>More task actions</Link>
          <ActionForm action={completeAction} onError={refreshAfterConflict} onSuccess={refreshAfterSave}>
            <input name="id" type="hidden" value={selectedItem.id} />
            <input name="expectedUpdatedAt" type="hidden" value={selectedItem.updatedAt} />
            <SubmitButton>Complete</SubmitButton>
          </ActionForm>
        </div>
      </div>
    </div> : null}

    {createContext ? <div aria-labelledby="scheduler-create-title" aria-modal="true" className="app-modal contextual-action-modal" role="dialog">
      <button aria-label="Close add work" className="app-modal-backdrop" onClick={closeDialogs} type="button" />
      <div className="app-modal-panel contextual-action-sheet scheduler-create-sheet" ref={selectedItem ? undefined : dialogRef}>
        <div className="app-modal-header"><div><span className="page-eyebrow">{formatDay(createContext.date)}{createContext.time !== null ? ` · ${timeLabel(createContext.time)}` : ' · Anytime'}</span><h2 id="scheduler-create-title">Add work</h2></div><button aria-label="Close" className="app-modal-close secondary" onClick={closeDialogs} type="button">Close</button></div>
        {createMode === 'choose' ? <div className="scheduler-add-choices">
          <button onClick={() => { setCreateMode('new'); setCreateDate(createContext.date); setCreateTime(createContext.time === null ? '' : formatTimeMinutesInput(createContext.time)); }} type="button"><strong>New Work</strong><span>Create a normal Worklist task.</span></button>
          <button onClick={() => setCreateMode('existing')} type="button"><strong>Existing Work</strong><span>Schedule an active task without duplicating it.</span></button>
        </div> : null}
        {createMode === 'existing' ? <div className="scheduler-existing-work">
          <div className="form-grid scheduler-existing-schedule">
            <label>Date <span className="optional-label">Optional</span><input onChange={(event) => { setCreateDate(event.target.value); if (!event.target.value) setCreateTime(''); }} type="date" value={createDate} /></label>
            <label>Time <span className="optional-label">Optional</span><input disabled={!createDate} onChange={(event) => setCreateTime(event.target.value)} type="time" value={createTime} /></label>
          </div>
          <label>Find active Worklist items<input autoComplete="off" onChange={(event) => setExistingSearch(event.target.value)} placeholder="Search task or account" value={existingSearch} /></label>
          {existingSearch ? <button className="secondary" onClick={() => setExistingSearch('')} type="button">Clear task search</button> : null}
          {items.length === 300 ? <p className="muted">Showing up to 300 active tasks due this week, recently overdue, or undated.</p> : null}
          {filteredExisting.length ? <ul>
            {filteredExisting.map((item) => <li key={item.id}><button disabled={Boolean(savingTaskId)} onClick={() => void scheduleExisting(item)} type="button">
              <strong>{item.title}</strong><span><SchedulerAccountLabel item={item} /></span><small>{item.dueDate ? `${formatDateOnlyInputValue(new Date(`${item.dueDate}T00:00:00.000Z`))}${item.dueTimeMinutes !== null ? ` · ${timeLabel(item.dueTimeMinutes)}` : ' · Anytime'}` : 'No date set'}</small>
            </button></li>)}
          </ul> : <p className="muted">No active items match. Try another search.</p>}
        </div> : null}
        {createMode === 'new' ? <ActionForm action={createAction as (data: FormData) => Promise<ActionResult>} className="scheduler-create-form" onSuccess={refreshAfterSave}>
          <input name="submissionKey" type="hidden" value={createSubmissionKey} />
          <label>Task<input autoFocus name="title" placeholder="What needs to happen?" required /></label>
          <label>Category<select onChange={(event) => { setCreateCategory(event.target.value); setSelectedAccount(null); setAccountSearch(''); }} value={createCategory} name="category"><option value="GENERAL">General</option><option value="AGENCY">Agency</option><option value="WHOLESALE">Wholesale</option></select></label>
          {createCategory === 'AGENCY' || createCategory === 'WHOLESALE' ? <div className="scheduler-account-picker">
            <label>Search account<input autoComplete="off" onChange={(event) => { setAccountSearch(event.target.value); setSelectedAccount(null); }} placeholder="Name, city, or account ID" value={selectedAccount?.name ?? accountSearch} /></label>
            {accountSearch && !selectedAccount ? <button className="secondary" onClick={() => setAccountSearch('')} type="button">Clear account search</button> : null}
            {selectedAccount ? <p className="muted">Selected: {selectedAccount.name}{selectedAccount.city ? ` · ${selectedAccount.city}` : ''}</p> : null}
            {createCategory === 'AGENCY' && selectedAccount ? <input name="agencyId" type="hidden" value={selectedAccount.id} /> : null}
            {createCategory === 'WHOLESALE' && selectedAccount ? <input name="wholesaleAccountId" type="hidden" value={selectedAccount.id} /> : null}
            {accountSearching ? <p className="muted" role="status">Searching accounts…</p> : null}
            {accountSearchError ? <p className="notice danger" role="alert">{accountSearchError}</p> : null}
            {!selectedAccount && accountSearch.trim().length >= 2 && accountResults.length > 0 ? <ul className="scheduler-account-results">
              <li className="scheduler-search-count" aria-live="polite">{accountResults.length === 20 ? 'Showing 20 accounts; refine your search.' : `${accountResults.length} account${accountResults.length === 1 ? '' : 's'} found.`}</li>
              {accountResults.map((account) => <li key={account.id}><button onClick={() => { setSelectedAccount(account); setAccountSearch(account.name); }} type="button">
                <strong>{account.name}</strong><span>{[account.city, account.identifier].filter(Boolean).join(' · ')}</span>
              </button></li>)}
            </ul> : null}
            {!selectedAccount && accountSearch.trim().length >= 2 && !accountSearching && !accountSearchError && accountResults.length === 0 ? <p className="muted">No accounts found.</p> : null}
          </div> : null}
          <div className="form-grid">
            <label>Date <span className="optional-label">Optional</span><input name="dueDate" onChange={(event) => { setCreateDate(event.target.value); if (!event.target.value) setCreateTime(''); }} type="date" value={createDate} /></label>
            <label>Time <span className="optional-label">Optional</span><input disabled={!createDate} name="dueTime" onChange={(event) => setCreateTime(event.target.value)} type="time" value={createTime} /></label>
            <label>Assigned to<select defaultValue={currentUserId} name="assignedToUserId"><option value="">Unassigned</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
          </div>
          <label>Notes <span className="optional-label">Optional</span><textarea name="detail" rows={2} /></label>
          <SubmitButton type="submit">Create Worklist task</SubmitButton>
        </ActionForm> : null}
        {feedback ? <p className="notice" role="status">{feedback}</p> : null}
        {createMode !== 'choose' ? <button className="secondary" onClick={() => { setCreateMode('choose'); setFeedback(''); }} type="button">Back to Add Work choices</button> : null}
      </div>
    </div> : null}
  </section>;
}
