import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const browserMock = vi.hoisted(() => ({
  runtime: { onMessage: { addListener: vi.fn() } },
  sidePanel: { setPanelBehavior: vi.fn().mockResolvedValue(undefined) },
  tabs: { query: vi.fn(), captureVisibleTab: vi.fn() },
}));
vi.mock('wxt/browser', () => ({ browser: browserMock }));

let onMessage: (message: unknown, sender: unknown, reply: (value: any) => void) => boolean;
const sender = { tab: { id: 7, windowId: 3, url: 'https://example.com/' } };

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal('defineBackground', (initialize: () => void) => initialize());
  await import('../entrypoints/background');
  onMessage = browserMock.runtime.onMessage.addListener.mock.calls[0]![0];
});

afterEach(() => vi.unstubAllGlobals());

it('enables the toolbar icon to open ClearWeb', () => {
  expect(browserMock.sidePanel.setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true });
});

it('rejects screenshot requests from an inactive tab before capture', async () => {
  browserMock.tabs.query.mockResolvedValue([{ id: 8, url: 'https://other.example/' }]);
  const reply = vi.fn();
  onMessage({ type: 'CAPTURE_VISIBLE_TAB' }, sender, reply);
  await vi.waitFor(() => expect(reply).toHaveBeenCalledWith(expect.objectContaining({ ok: false })));
  expect(browserMock.tabs.captureVisibleTab).not.toHaveBeenCalled();
});

it('discards a screenshot if the user switches tabs while capturing', async () => {
  browserMock.tabs.query.mockResolvedValueOnce([sender.tab]).mockResolvedValueOnce([{ id: 8 }]);
  browserMock.tabs.captureVisibleTab.mockResolvedValue('data:image/png;base64,private');
  const reply = vi.fn();
  onMessage({ type: 'CAPTURE_VISIBLE_TAB' }, sender, reply);
  await vi.waitFor(() => expect(reply).toHaveBeenCalledWith(expect.objectContaining({ ok: false })));
  expect(reply.mock.calls[0]?.[0]).not.toHaveProperty('dataUrl');
});

it('returns a capture only to its active source tab', async () => {
  browserMock.tabs.query.mockResolvedValue([sender.tab]);
  browserMock.tabs.captureVisibleTab.mockResolvedValue('data:image/png;base64,ok');
  const reply = vi.fn();
  onMessage({ type: 'CAPTURE_VISIBLE_TAB' }, sender, reply);
  await vi.waitFor(() => expect(reply).toHaveBeenCalledWith({ ok: true, dataUrl: 'data:image/png;base64,ok' }));
});
