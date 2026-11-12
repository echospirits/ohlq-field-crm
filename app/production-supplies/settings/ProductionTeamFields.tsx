'use client';
import { useState } from 'react';
import { RecordPicker } from '../../components/RecordPicker';
type Person = { id: string; label: string };
type Team = { id: string; name: string; memberIds: string[] };
export function ProductionTeamFields({ teams, users, initialTeamId, viewerUserIds, managerUserIds }: { teams: Team[]; users: Person[]; initialTeamId: string; viewerUserIds: string[]; managerUserIds: string[] }) {
  const [members, setMembers] = useState(teams.find(t => t.id === initialTeamId)?.memberIds ?? []);
  return <>
    <RecordPicker label="Production team" name="productionTeamId" defaultValue={initialTeamId} options={teams.map(team => ({ value: team.id, label: team.name }))} clearLabel="Create Production team" placeholder="Create Production team" onChange={value => setMembers(teams.find(t => t.id === value)?.memberIds ?? [])} />
    <p className="field-note">Members below belong to the selected team while retaining their current role. Monitoring, viewing and managing are separate choices. Administrators can view and manage.</p>
    <div className="supply-membership-table">{users.map(person => <fieldset key={person.id}><legend>{person.label}</legend><label><input type="checkbox" name="memberIds" value={person.id} checked={members.includes(person.id)} onChange={event => setMembers(event.target.checked ? [...members, person.id] : members.filter(id => id !== person.id))} />Production member</label><label><input type="checkbox" name="viewerUserIds" value={person.id} defaultChecked={viewerUserIds.includes(person.id)} />View supplies</label><label><input type="checkbox" name="managerUserIds" value={person.id} defaultChecked={managerUserIds.includes(person.id)} />Manage supplies</label></fieldset>)}</div>
  </>;
}
