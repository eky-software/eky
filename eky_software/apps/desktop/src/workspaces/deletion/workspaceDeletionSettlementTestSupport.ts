const phases = ['finalizer', 'recordRemoved', 'ownerClose', 'leaseRelease', 'recovery',
  'fixturePostcheck', 'completionSend', 'reservationRelease'] as const;
type Phase = (typeof phases)[number];
type State = 'entered' | 'fulfilled' | 'rejected';
type Counter = { entered: number; fulfilled: number; rejected: number; pending: number; elapsedMs: number };
const maximumEvents = 128;

// Small-fixture observation only. No payload, error value, I/O or authority is retained.
export function createWorkspaceDeletionSettlementObservation() {
  const counters = Object.fromEntries(phases.map(phase => [phase,
    { entered: 0, fulfilled: 0, rejected: 0, pending: 0, elapsedMs: 0 }])) as Record<Phase, Counter>;
  const events: { phase: Phase; state: State; call: number }[] = [];
  let truncated = false;
  const event = (phase: Phase, state: State, call: number) => {
    if (events.length === maximumEvents) { truncated = true; return; }
    events.push({ phase, state, call });
  };
  const enter = (phase: Phase) => {
    const counter = counters[phase], call = ++counter.entered, started = performance.now();
    counter.pending++; event(phase, 'entered', call);
    return (state: 'fulfilled' | 'rejected') => {
      counter.pending--; counter[state]++; counter.elapsedMs += performance.now() - started;
      event(phase, state, call);
    };
  };
  return Object.freeze({
    sync<This, Args extends unknown[], Result>(phase: Phase, work: (this: This, ...args: Args) => Result) {
      return function(this: This, ...args: Args): Result {
        const settle = enter(phase);
        try { const result = work.apply(this, args); settle('fulfilled'); return result; }
        catch (error) { settle('rejected'); throw error; }
      };
    },
    async<This, Args extends unknown[], Result>(phase: Phase, work: (this: This, ...args: Args) => Promise<Result>) {
      return function(this: This, ...args: Args): Promise<Result> {
        const settle = enter(phase);
        let result: Promise<Result>;
        try { result = work.apply(this, args); }
        catch (error) { settle('rejected'); throw error; }
        void result.then(() => settle('fulfilled'), () => settle('rejected'));
        return result;
      };
    },
    read() {
      return Object.freeze({ counters: Object.freeze(Object.fromEntries(phases.map(phase =>
        [phase, Object.freeze({ ...counters[phase] })]))),
      events: Object.freeze(events.map(value => Object.freeze({ ...value }))), truncated });
    },
  });
}
