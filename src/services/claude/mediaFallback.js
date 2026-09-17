// Retry only a confirmed media rejection, once, after the process exits. Keep
// the session so earlier tool work is not replayed as a fresh user request.
export function canRecoverMedia(run) {
  return run?.operation === 'chat' && run.status === 'error'
    && run.diagnosticKind === 'unsupported-media' && Boolean(run.request)
    && !run.request.recoverMedia
}

export function mediaFallbackRequest(request) {
  return {
    ...request,
    resume: true,
    recoverMedia: true,
    prompt: "Continue answering the user's most recent request in this session. The provider rejected image/document input. Briefly explain that you cannot read the images/documents and are skipping them, then address all usable text and code from that request. Do not reopen images/PDFs, request or return image/document tool content, or claim to have seen it. Preserve completed tool work; do not repeat actions already performed. If the request depends entirely on visual information, ask for a text description instead of guessing. This is an automatic continuation, not a new user task.",
  }
}
