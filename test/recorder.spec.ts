import { Recorder } from '../src/core/recorder/recorder.service';

function entry(path = '/v2/customers') {
  return {
    method: 'GET',
    path,
    originalPath: path,
    query: {},
    headers: {},
    body: null,
  };
}

describe('Recorder', () => {
  it('numbers requests in arrival order, which is what a test asserts on', () => {
    const recorder = new Recorder();

    recorder.record(entry('/a'));
    recorder.record(entry('/b'));

    expect(recorder.all().map((request) => request.sequence)).toEqual([1, 2]);
  });

  it('stamps each request with the time it arrived', () => {
    const recorder = new Recorder();

    recorder.record(entry());

    expect(recorder.all()[0].receivedAt).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(recorder.all()[0].receivedAt))).toBe(false);
  });

  it('filters by a path fragment, so an assertion reads as intent', () => {
    const recorder = new Recorder();

    recorder.record(entry('/v2/customers'));
    recorder.record(entry('/v2/orders'));
    recorder.record(entry('/v2/customers/C-1/orders'));

    expect(recorder.matching('/v2/customers')).toHaveLength(2);
    expect(recorder.matching('nothing')).toEqual([]);
  });

  it('clear empties the log and restarts the counter', () => {
    const recorder = new Recorder();

    recorder.record(entry());
    recorder.clear();

    expect(recorder.all()).toEqual([]);

    recorder.record(entry());

    expect(recorder.all()[0].sequence).toBe(1);
  });

  it('keeps a bounded window so a long-lived container does not grow without limit', () => {
    const recorder = new Recorder({
      presets: [],
      keyOf: () => undefined,
      maxRules: 10,
      maxRecorded: 3,
    });

    for (let index = 0; index < 5; index += 1) {
      recorder.record(entry(`/request/${index}`));
    }

    expect(recorder.all().map((request) => request.path)).toEqual([
      '/request/2',
      '/request/3',
      '/request/4',
    ]);
  });

  it('returns the stored entry, so the answer can be filled in later', () => {
    const recorder = new Recorder();
    const stored = recorder.record(entry());

    stored.responseStatus = 404;

    expect(recorder.all()[0].responseStatus).toBe(404);
  });

  it('hands out a copy of the list, so a caller cannot reorder the log by accident', () => {
    const recorder = new Recorder();

    recorder.record(entry());
    recorder.all().pop();
    recorder.all().length = 0;

    expect(recorder.all()).toHaveLength(1);
  });
});
