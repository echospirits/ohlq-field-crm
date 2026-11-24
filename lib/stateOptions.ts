import { US_STATES } from './usStates';
const stateName = (code: string) => US_STATES.find(state => state.code === code)?.name ?? code;
export function accountStateValues(states: readonly string[]) { return states.flatMap(code => [code,stateName(code)]); }
