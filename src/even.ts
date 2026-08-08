// Glasses bridge wrapper for Card Pack. Single full-screen text container.
// Cribbed from the lyrics-glow / Cue / Hearts pattern (BLE-write
// serialization, gesture classification).

import {
  CreateStartUpPageContainer,
  EventSourceType,
  OsEventTypeList,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'

// Two-layer page (Image-Based App Pattern from the glasses-ui guide,
// applied to a text-first app): an invisible single-space event-capture
// layer underneath a separate display layer. Swipes/taps land on the
// EVENT layer — which has nothing scrollable — so the firmware never
// overscroll-bounces the VISIBLE content. (A single capture+content
// container rubber-bands on every swipe because the gesture scrolls the
// content it's drawing; splitting them removes the visible bounce.)
const DISPLAY_ID = 1
const DISPLAY_NAME = 'display'
const EVENT_ID = 2
const EVENT_NAME = 'events'
const BRIDGE_TIMEOUT_MS = 4000
const WIDTH = 576
const HEIGHT = 288

export type InputSource = 'glasses' | 'ring' | 'unknown'
export type SwipeDir = 'up' | 'down'

export interface EvenRuntime {
  render: (text: string) => Promise<void>
  onTap: (handler: (source: InputSource) => void) => void
  onSwipe: (handler: (dir: SwipeDir, source: InputSource) => void) => void
  onDoubleTap: (handler: (source: InputSource) => void) => void
  onForeground: (handler: () => void) => void
  exitApp: () => Promise<void>
  getStorage: (key: string) => Promise<string | null>
  setStorage: (key: string, value: string) => Promise<void>
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error('Timed out waiting for the Even bridge')),
      timeoutMs,
    )
    promise.then(
      v => { window.clearTimeout(timer); resolve(v) },
      e => { window.clearTimeout(timer); reject(e) },
    )
  })
}

export async function connectEvenRuntime(initial: string): Promise<EvenRuntime | null> {
  let bridge: Awaited<ReturnType<typeof waitForEvenAppBridge>>
  try {
    bridge = await withTimeout(waitForEvenAppBridge(), BRIDGE_TIMEOUT_MS)
  } catch {
    return null
  }

  // Visible content layer. NOT event-capturing, so swipes are never
  // routed here — the firmware has no reason to scroll it, so it can't
  // bounce. Updated in-place via textContainerUpgrade.
  const display = new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: WIDTH,
    height: HEIGHT,
    borderWidth: 0,
    borderColor: 5,
    paddingLength: 6,
    containerID: DISPLAY_ID,
    containerName: DISPLAY_NAME,
    content: initial,
    isEventCapture: 0,
  })

  // Invisible event sink. A single space (cannot be empty) with no border
  // and no padding — nothing to scroll, so the swipe-overscroll bounce has
  // nowhere to render. Swipes still fire as SCROLL_TOP/SCROLL_BOTTOM text
  // events from here (text-capture containers report swipes by direction).
  const events = new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: WIDTH,
    height: HEIGHT,
    borderWidth: 0,
    borderColor: 0,
    paddingLength: 0,
    containerID: EVENT_ID,
    containerName: EVENT_NAME,
    content: ' ',
    isEventCapture: 1,
  })

  // Declaration order is z-order: `events` first, `display` on top. The
  // event layer's single space is transparent, so stacking is moot
  // visually; capture is by the isEventCapture flag, not z-order.
  const created = await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({ containerTotalNum: 2, textObject: [events, display] }),
  )
  if (created !== 0) return null

  let lastSent = initial
  let lastLen = initial.length

  // Serialize BLE writes — concurrent textContainerUpgrade crashes the link.
  let busy: Promise<unknown> = Promise.resolve()
  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = busy.then(work, work) as Promise<T>
    busy = next.then(() => undefined, () => undefined)
    return next
  }

  let tapHandler: ((source: InputSource) => void) | null = null
  let swipeHandler: ((dir: SwipeDir, source: InputSource) => void) | null = null
  let doubleTapHandler: ((source: InputSource) => void) | null = null
  let foregroundHandler: (() => void) | null = null

  function classifySource(src: number | undefined): InputSource {
    if (src === EventSourceType.TOUCH_EVENT_FROM_RING) return 'ring'
    if (
      src === EventSourceType.TOUCH_EVENT_FROM_GLASSES_L ||
      src === EventSourceType.TOUCH_EVENT_FROM_GLASSES_R
    ) {
      return 'glasses'
    }
    return 'unknown'
  }

  bridge.onEvenHubEvent(event => {
    if (event.textEvent) {
      const t = event.textEvent.eventType ?? 0
      if (t === OsEventTypeList.SCROLL_TOP_EVENT) swipeHandler?.('up', 'unknown')
      else if (t === OsEventTypeList.SCROLL_BOTTOM_EVENT) swipeHandler?.('down', 'unknown')
      return
    }
    if (event.sysEvent) {
      const t = event.sysEvent.eventType ?? 0
      const src = classifySource(event.sysEvent.eventSource)
      if (t === 0) { tapHandler?.(src); return }
      if (t === OsEventTypeList.DOUBLE_CLICK_EVENT) { doubleTapHandler?.(src); return }
      if (t === OsEventTypeList.FOREGROUND_ENTER_EVENT) { foregroundHandler?.(); return }
    }
  })

  return {
    async render(text: string): Promise<void> {
      if (text === lastSent) return
      await enqueue(async () => {
        await bridge.textContainerUpgrade(
          new TextContainerUpgrade({
            containerID: DISPLAY_ID,
            containerName: DISPLAY_NAME,
            contentOffset: 0,
            contentLength: Math.max(lastLen, text.length),
            content: text,
          }),
        )
        lastSent = text
        lastLen = text.length
      })
    },
    onTap(h) { tapHandler = h },
    onSwipe(h) { swipeHandler = h },
    onDoubleTap(h) { doubleTapHandler = h },
    onForeground(h) { foregroundHandler = h },
    async exitApp(): Promise<void> { await bridge.shutDownPageContainer(1) },
    async getStorage(key): Promise<string | null> {
      try { return await bridge.getLocalStorage(key) } catch { return null }
    },
    async setStorage(key, value): Promise<void> {
      try { await bridge.setLocalStorage(key, value) } catch { /* ignore */ }
    },
  }
}
