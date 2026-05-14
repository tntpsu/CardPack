// Glasses bridge wrapper for Card Pack. Single full-screen text container.
// Cribbed from the lyrics-glow / Cue / Hearts pattern (BLE-write
// serialization, gesture classification).
import { CreateStartUpPageContainer, EventSourceType, OsEventTypeList, TextContainerProperty, TextContainerUpgrade, waitForEvenAppBridge, } from '@evenrealities/even_hub_sdk';
const MAIN_ID = 1;
const MAIN_NAME = 'main';
const BRIDGE_TIMEOUT_MS = 4000;
const WIDTH = 576;
const HEIGHT = 288;
function withTimeout(promise, timeoutMs) {
    return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('Timed out waiting for the Even bridge')), timeoutMs);
        promise.then(v => { window.clearTimeout(timer); resolve(v); }, e => { window.clearTimeout(timer); reject(e); });
    });
}
export async function connectEvenRuntime(initial) {
    let bridge;
    try {
        bridge = await withTimeout(waitForEvenAppBridge(), BRIDGE_TIMEOUT_MS);
    }
    catch {
        return null;
    }
    const main = new TextContainerProperty({
        xPosition: 0,
        yPosition: 0,
        width: WIDTH,
        height: HEIGHT,
        borderWidth: 0,
        borderColor: 5,
        paddingLength: 6,
        containerID: MAIN_ID,
        containerName: MAIN_NAME,
        content: initial,
        isEventCapture: 1,
    });
    const created = await bridge.createStartUpPageContainer(new CreateStartUpPageContainer({ containerTotalNum: 1, textObject: [main] }));
    if (created !== 0)
        return null;
    let lastSent = initial;
    let lastLen = initial.length;
    // Serialize BLE writes — concurrent textContainerUpgrade crashes the link.
    let busy = Promise.resolve();
    function enqueue(work) {
        const next = busy.then(work, work);
        busy = next.then(() => undefined, () => undefined);
        return next;
    }
    let tapHandler = null;
    let swipeHandler = null;
    let doubleTapHandler = null;
    let foregroundHandler = null;
    function classifySource(src) {
        if (src === EventSourceType.TOUCH_EVENT_FROM_RING)
            return 'ring';
        if (src === EventSourceType.TOUCH_EVENT_FROM_GLASSES_L ||
            src === EventSourceType.TOUCH_EVENT_FROM_GLASSES_R) {
            return 'glasses';
        }
        return 'unknown';
    }
    bridge.onEvenHubEvent(event => {
        if (event.textEvent) {
            const t = event.textEvent.eventType ?? 0;
            if (t === OsEventTypeList.SCROLL_TOP_EVENT)
                swipeHandler?.('up', 'unknown');
            else if (t === OsEventTypeList.SCROLL_BOTTOM_EVENT)
                swipeHandler?.('down', 'unknown');
            return;
        }
        if (event.sysEvent) {
            const t = event.sysEvent.eventType ?? 0;
            const src = classifySource(event.sysEvent.eventSource);
            if (t === 0) {
                tapHandler?.(src);
                return;
            }
            if (t === OsEventTypeList.DOUBLE_CLICK_EVENT) {
                doubleTapHandler?.(src);
                return;
            }
            if (t === OsEventTypeList.FOREGROUND_ENTER_EVENT) {
                foregroundHandler?.();
                return;
            }
        }
    });
    return {
        async render(text) {
            if (text === lastSent)
                return;
            await enqueue(async () => {
                await bridge.textContainerUpgrade(new TextContainerUpgrade({
                    containerID: MAIN_ID,
                    containerName: MAIN_NAME,
                    contentOffset: 0,
                    contentLength: Math.max(lastLen, text.length),
                    content: text,
                }));
                lastSent = text;
                lastLen = text.length;
            });
        },
        onTap(h) { tapHandler = h; },
        onSwipe(h) { swipeHandler = h; },
        onDoubleTap(h) { doubleTapHandler = h; },
        onForeground(h) { foregroundHandler = h; },
        async exitApp() { await bridge.shutDownPageContainer(1); },
        async getStorage(key) {
            try {
                return await bridge.getLocalStorage(key);
            }
            catch {
                return null;
            }
        },
        async setStorage(key, value) {
            try {
                await bridge.setLocalStorage(key, value);
            }
            catch { /* ignore */ }
        },
    };
}
