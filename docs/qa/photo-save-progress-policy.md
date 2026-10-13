# Photo save progress and provisional PNG deadline

## Approved product policy

PNG creation has a shared 30,000 ms safety deadline measured from the accepted shutter request. This provisional value is an explicit UX policy, not a measured optimal latency or a performance fix. At 10,000 ms, the UI warns without failing. Both elapsed time and `overSoftLimitMs` remain visible in image-free capture diagnostics, including successful slow captures. The readback and encoding stages never restart either deadline. A monotonic check before accepting PNG success prevents delayed timer ordering from accepting an expired result.

The UI shows indeterminate activity with accessible text: photo preparation, PNG creation, then Album storage. It never invents percentage progress. Reduced-motion users receive a static activity indicator. Only PNG creation has the 30-second limit; the browser event loop can delay notification while synchronous readback is blocking.

## Cancellation and recovery

The visible `촬영 취소` action is offered only during PNG preparation/encoding. It cancels the owned request, clears its timers and frame listener, releases the snapshot canvas, restores the shutter, and ignores a late callback. The camera remains open for another shot. Closing, pagehide, takeover and account changes retain their existing invalidation behavior. Native canvas encoding has no abort API: cancellation stops accepting its result, not necessarily the browser's internal encoder immediately.

Once a PNG is available, the original download request and preview retain their existing behavior. Album storage is a separate stage; an already requested download cannot be undone by closing Photo Mode. No full Album AbortSignal or Worker implementation is included. Existing Album failure preserves the PNG preview and direct-save fallback.

Known existing limit: thumbnail encoding or an Album storage operation can remain pending without a general deadline. The 30-second claim intentionally does not cover Album storage. Leaving Photo Mode remains available. Full Album cancellation/late-write prevention needs a separately scoped change; a Promise.race alone is insufficient.

## Verification policy

- Unit tests cover 10-second warning without rejection; successful slow capture diagnostics; shared 30-second deadline; success callback racing a delayed timer; late frame/readback; explicit cancel/retry; stale callback; session and account revalidation; observer cleanup; Album failure fallback.
- Existing downloaded PNG decode, dimensions, pixel-for-pixel framebuffer comparison, original/thumbnail separation and Album readback assertions remain mandatory.
- Smartphone and synthetic PNG browser reports now retain successful capture diagnostics. Over-10-second saves are reported even when they meet the provisional product deadline.
- No skip, capture retry, resolution reduction, extra render, or workflow timeout relaxation is part of this change. It is not a claim that the underlying SwiftShader/PNG scheduling performance issue is solved.
- PR #383's mounted-photo failure observer is separate and unchanged; reuse it rather than duplicate or weaken its assertion.
- Local verification: all 4,565 World unit tests passed; the focused Photo/Phone suite passed 178 tests. Browser scripts pass syntax checks. TCP serving is available, but the actual existing Chromium launch failed with `process_singleton_posix.cc` UNIX socket `EPERM` before any page rendered. Browser pixel/layout checks remain unexecuted here and require the integration environment; no bypass was attempted.
