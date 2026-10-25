function createRedactor(env) {
  const secrets = new Set(Object.entries(env).filter(([key, value]) => value && /secret|password|token|credential|mongodb_uri/i.test(key)).map(([, value]) => value));
  try {
    const uri = new URL(env.MONGODB_URI);
    for (const value of [uri.username, uri.password]) {
      if (!value) continue;
      secrets.add(value);
      try { secrets.add(decodeURIComponent(value)); } catch {}
    }
  } catch {}
  return (value) => {
    let text = String(value).replace(/mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi, '[REDACTED MongoDB URI]');
    for (const secret of [...secrets].sort((a, b) => b.length - a.length)) text = text.split(secret).join('[REDACTED]');
    return text;
  };
}
function redactError(error, redact, seen = new Set()) {
  if (!error || seen.has(error)) return undefined;
  seen.add(error);
  const result = {};
  for (const key of ['name', 'code', 'codeName', 'message']) {
    if (error[key] !== undefined) result[key] = typeof error[key] === 'number' ? error[key] : redact(error[key]);
  }
  if (error.errorResponse?.errmsg) result.serverMessage = redact(error.errorResponse.errmsg);
  if (error.cause) result.cause = redactError(error.cause, redact, seen);
  if (error.reason?.servers instanceof Map) result.serverErrors = [...error.reason.servers.values()].filter(server => server.error).map(server => redactError(server.error, redact, seen)).filter(Boolean);
  return result;
}
module.exports = { createRedactor, redactError };
