// Shared by the phone window and the extension service worker.
function normalizeDialTarget(value) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/^tel:/i, "").replace(/[\s().-]/g, "");
  return /^\+?[0-9]{2,15}$/.test(cleaned) ? cleaned : null;
}

// FreePBX DND feature calls are dialed through the same path as ordinary numbers.
function normalizeCallTarget(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed === "*78" || trimmed === "*79" ? trimmed : normalizeDialTarget(value);
}

function normalizeTransferTarget(value) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/[\s().-]/g, "");
  return /^(?:\*[0-9]{2,15}|\+?[0-9]{2,15})$/.test(cleaned) ? cleaned : null;
}
