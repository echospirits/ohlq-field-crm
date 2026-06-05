'use client';

import { useMemo, useState } from 'react';
import { DatePickerField } from '../components/DatePickerField';
import {
  buildVisitFieldsFromStructuredNote,
  MAX_TRANSCRIPT_LENGTH,
  type StructuredVisitNote,
  type SuggestedAccountUpdates,
  type SuggestedVoiceFollowUp,
  type VoiceVisitType,
} from '../../lib/voiceVisitNoteShared';

type VoiceAccountContext = {
  id: string;
  name: string;
  identifier: string | null;
  city: string | null;
  phone: string | null;
};

type EditableFollowUp = SuggestedVoiceFollowUp & {
  selected: boolean;
};

type VoiceVisitNotePanelProps = {
  accountContext: VoiceAccountContext | null;
  visitType: VoiceVisitType;
  summary: string;
  outcomes: string;
  nextStep: string;
  setSummary: (value: string) => void;
  setOutcomes: (value: string) => void;
  setNextStep: (value: string) => void;
};

const blankAccountUpdates: SuggestedAccountUpdates = {
  buyerName: null,
  preferences: null,
  preferredContactTime: null,
};

const splitLines = (value: string) =>
  value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

const joinLines = (values: string[]) => values.join('\n');

const toEditableFollowUps = (followUps: SuggestedVoiceFollowUp[]): EditableFollowUp[] =>
  followUps.map((followUp) => ({ ...followUp, selected: false }));

const patchNote = <Key extends keyof StructuredVisitNote>(
  note: StructuredVisitNote,
  key: Key,
  value: StructuredVisitNote[Key],
) => ({
  ...note,
  [key]: value,
});

export function VoiceVisitNotePanel({
  accountContext,
  visitType,
  summary,
  outcomes,
  nextStep,
  setSummary,
  setOutcomes,
  setNextStep,
}: VoiceVisitNotePanelProps) {
  const [transcript, setTranscript] = useState('');
  const [structuredNote, setStructuredNote] = useState<StructuredVisitNote | null>(null);
  const [followUps, setFollowUps] = useState<EditableFollowUp[]>([]);
  const [useStructuredFields, setUseStructuredFields] = useState(true);
  const [beforeStructuredFields, setBeforeStructuredFields] = useState({ summary, outcomes, nextStep });
  const [isStructuring, setIsStructuring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedTranscript = transcript.trim();
  const transcriptCharactersRemaining = MAX_TRANSCRIPT_LENGTH - transcript.length;
  const canStructure = trimmedTranscript.length >= 20 && transcript.length <= MAX_TRANSCRIPT_LENGTH && !isStructuring;

  const accountLabel = useMemo(() => {
    if (!accountContext) {
      return visitType === 'agency' ? 'No agency selected yet' : 'No wholesale account selected yet';
    }

    return [accountContext.name, accountContext.identifier, accountContext.city].filter(Boolean).join(' / ');
  }, [accountContext, visitType]);

  const applyStructuredFields = (note: StructuredVisitNote) => {
    if (!useStructuredFields) {
      return;
    }

    const fields = buildVisitFieldsFromStructuredNote(note);
    setSummary(fields.summary);
    setOutcomes(fields.outcomes);
    setNextStep(fields.nextStep);
  };

  const updateStructuredNote = (note: StructuredVisitNote) => {
    setStructuredNote(note);
    applyStructuredFields(note);
  };

  const handleStructure = async () => {
    if (trimmedTranscript.length < 20) {
      setError('Add a little more detail before structuring the visit note.');
      return;
    }

    if (transcript.length > MAX_TRANSCRIPT_LENGTH) {
      setError(`Voice note transcripts must be ${MAX_TRANSCRIPT_LENGTH} characters or less.`);
      return;
    }

    setError(null);
    setIsStructuring(true);
    setBeforeStructuredFields({ summary, outcomes, nextStep });

    try {
      const response = await fetch('/api/visits/structure-note', {
        body: JSON.stringify({
          accountContext,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
          transcript: trimmedTranscript,
          visitType,
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error ?? 'The visit note could not be structured.');
      }

      const nextNote = payload as StructuredVisitNote;
      setUseStructuredFields(true);
      setStructuredNote(nextNote);
      setFollowUps(toEditableFollowUps(nextNote.suggestedFollowUps));

      const fields = buildVisitFieldsFromStructuredNote(nextNote);
      setSummary(fields.summary);
      setOutcomes(fields.outcomes);
      setNextStep(fields.nextStep);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'The visit note could not be structured.');
    } finally {
      setIsStructuring(false);
    }
  };

  const handleUseStructuredFields = (checked: boolean) => {
    setUseStructuredFields(checked);

    if (!structuredNote) {
      return;
    }

    if (checked) {
      const fields = buildVisitFieldsFromStructuredNote(structuredNote);
      setSummary(fields.summary);
      setOutcomes(fields.outcomes);
      setNextStep(fields.nextStep);
      return;
    }

    setSummary(beforeStructuredFields.summary);
    setOutcomes(beforeStructuredFields.outcomes);
    setNextStep(beforeStructuredFields.nextStep);
  };

  const handleListChange = (key: keyof StructuredVisitNote, value: string) => {
    if (!structuredNote) {
      return;
    }

    updateStructuredNote(patchNote(structuredNote, key, splitLines(value)));
  };

  const handleAccountUpdateChange = (key: keyof SuggestedAccountUpdates, value: string) => {
    if (!structuredNote) {
      return;
    }

    updateStructuredNote({
      ...structuredNote,
      suggestedAccountUpdates: {
        ...structuredNote.suggestedAccountUpdates,
        [key]: value.trim() || null,
      },
    });
  };

  const updateFollowUp = (index: number, patch: Partial<EditableFollowUp>) => {
    setFollowUps((items) => items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  };

  return (
    <section className="voice-note-panel" aria-label="Voice visit note">
      <div className="voice-note-header">
        <div>
          <h2>Voice Note</h2>
          <p>Say who you met, what happened, products discussed, objections, and next steps.</p>
        </div>
        <span className="pill">{accountLabel}</span>
      </div>

      <label>Dictated or pasted transcript</label>
      <textarea
        className="voice-transcript"
        rows={7}
        placeholder="Example: Met with Sara, the bar manager. Discussed our vodka for the summer cocktail menu. Price was a concern. Follow up next Tuesday with a sample and menu idea."
        value={transcript}
        onChange={(event) => setTranscript(event.target.value)}
      />
      <div className="voice-note-actions">
        <button disabled={!canStructure} type="button" onClick={handleStructure}>
          {isStructuring ? 'Structuring...' : 'Structure note'}
        </button>
        <span className={transcriptCharactersRemaining < 0 ? 'field-note danger-text' : 'field-note'}>
          {transcriptCharactersRemaining < 0
            ? `${Math.abs(transcriptCharactersRemaining)} characters over limit`
            : `${transcriptCharactersRemaining} characters left`}
        </span>
      </div>

      {error ? (
        <p className="voice-state is-error" role="alert">
          {error}
        </p>
      ) : null}

      {!structuredNote && !error ? (
        <p className="voice-state">Structured suggestions will appear here. Nothing is saved until you review and log the visit.</p>
      ) : null}

      {structuredNote ? (
        <div className="voice-review">
          <div className="voice-review-heading">
            <h3>Review before saving</h3>
            <p>Edit anything below. Account changes and tasks are not created unless explicitly selected.</p>
          </div>

          <label className="voice-toggle">
            <input
              checked={useStructuredFields}
              type="checkbox"
              onChange={(event) => handleUseStructuredFields(event.target.checked)}
            />
            <span>Save these structured fields with the visit note</span>
          </label>

          <label>Visit summary</label>
          <textarea
            rows={3}
            value={structuredNote.summary}
            onChange={(event) => updateStructuredNote({ ...structuredNote, summary: event.target.value })}
          />

          <div className="voice-review-grid">
            <label>
              Contact name
              <input
                value={structuredNote.contactName ?? ''}
                onChange={(event) => updateStructuredNote({ ...structuredNote, contactName: event.target.value || null })}
              />
            </label>
            <label>
              Contact role
              <input
                value={structuredNote.contactRole ?? ''}
                onChange={(event) => updateStructuredNote({ ...structuredNote, contactRole: event.target.value || null })}
              />
            </label>
            <label>
              What happened / outcomes
              <textarea
                rows={4}
                value={joinLines(structuredNote.outcomes)}
                onChange={(event) => handleListChange('outcomes', event.target.value)}
              />
            </label>
            <label>
              Products discussed
              <textarea
                rows={4}
                value={joinLines(structuredNote.productsDiscussed)}
                onChange={(event) => handleListChange('productsDiscussed', event.target.value)}
              />
            </label>
            <label>
              Opportunities
              <textarea
                rows={4}
                value={joinLines(structuredNote.opportunities)}
                onChange={(event) => handleListChange('opportunities', event.target.value)}
              />
            </label>
            <label>
              Objections
              <textarea
                rows={4}
                value={joinLines(structuredNote.objections)}
                onChange={(event) => handleListChange('objections', event.target.value)}
              />
            </label>
            <label>
              Competitor mentions
              <textarea
                rows={3}
                value={joinLines(structuredNote.competitorMentions)}
                onChange={(event) => handleListChange('competitorMentions', event.target.value)}
              />
            </label>
            <label>
              Next step
              <textarea
                rows={3}
                value={structuredNote.nextStep ?? ''}
                onChange={(event) => updateStructuredNote({ ...structuredNote, nextStep: event.target.value || null })}
              />
            </label>
          </div>

          <details className="compact-details nested-details" open={followUps.length > 0}>
            <summary>Suggested follow-up tasks</summary>
            {followUps.length === 0 ? <p className="field-note">No follow-up task was detected.</p> : null}
            {followUps.map((followUp, index) => (
              <div className="voice-follow-up" key={`voice-follow-up-${index}`}>
                <label className="voice-toggle">
                  <input
                    checked={followUp.selected}
                    name="voiceFollowUpSelected"
                    type="checkbox"
                    value={index}
                    onChange={(event) => updateFollowUp(index, { selected: event.target.checked })}
                  />
                  <span>Create this worklist item</span>
                </label>
                <label>
                  Task title
                  <input
                    name="voiceFollowUpTitle"
                    value={followUp.title}
                    onChange={(event) => updateFollowUp(index, { title: event.target.value })}
                  />
                </label>
                <label>
                  Details
                  <textarea
                    name="voiceFollowUpDescription"
                    rows={2}
                    value={followUp.description ?? ''}
                    onChange={(event) => updateFollowUp(index, { description: event.target.value || null })}
                  />
                </label>
                <label>
                  Due date
                  <DatePickerField
                    name="voiceFollowUpDueDate"
                    pickerLabel="Choose follow-up due date"
                    value={followUp.dueDate ?? ''}
                    onChange={(event) => updateFollowUp(index, { dueDate: event.target.value || null })}
                  />
                </label>
                <input name="voiceFollowUpDueDateLabel" type="hidden" value={followUp.dueDateLabel ?? ''} />
                {followUp.dueDateLabel && !followUp.dueDate ? (
                  <p className="field-note">Uncertain date heard as "{followUp.dueDateLabel}". Pick a date before saving a dated task.</p>
                ) : null}
              </div>
            ))}
          </details>

          <details className="compact-details nested-details">
            <summary>Account notes and update suggestions</summary>
            <label>
              Account notes to review
              <textarea
                rows={3}
                value={structuredNote.accountNotes ?? ''}
                onChange={(event) => updateStructuredNote({ ...structuredNote, accountNotes: event.target.value || null })}
              />
            </label>
            <div className="voice-review-grid">
              <label>
                Buyer name
                <input
                  value={structuredNote.suggestedAccountUpdates.buyerName ?? ''}
                  onChange={(event) => handleAccountUpdateChange('buyerName', event.target.value)}
                />
              </label>
              <label>
                Preferred contact time
                <input
                  value={structuredNote.suggestedAccountUpdates.preferredContactTime ?? ''}
                  onChange={(event) => handleAccountUpdateChange('preferredContactTime', event.target.value)}
                />
              </label>
              <label>
                Preferences
                <textarea
                  rows={3}
                  value={structuredNote.suggestedAccountUpdates.preferences ?? ''}
                  onChange={(event) => handleAccountUpdateChange('preferences', event.target.value)}
                />
              </label>
            </div>
            <label className="voice-toggle is-disabled">
              <input disabled type="checkbox" />
              <span>Apply account/contact updates is review-only in this MVP</span>
            </label>
          </details>
        </div>
      ) : null}
    </section>
  );
}
