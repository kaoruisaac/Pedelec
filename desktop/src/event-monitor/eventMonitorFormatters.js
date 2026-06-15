export function prettyJson(value) {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch (err) {
    return String(value);
  }
}

export function formatTimestamp(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

export function formatValue(value) {
  if (value === undefined || value === null || value === "") {
    return "-";
  }

  return String(value);
}

export function statusLabel(status) {
  return formatValue(status);
}

export function commandDetails(event) {
  return prettyJson({
    seq: event.seq,
    processId: event.processId,
    program: event.program,
    args: event.args,
    cwd: event.cwd,
    prompt: event.prompt,
  });
}

export function toolCallDetails(event) {
  return prettyJson({
    seq: event.seq,
    requestId: event.requestId,
    toolName: event.toolName,
    args: event.args,
    receivedAt: event.receivedAt,
  });
}

export function toolResultDetails(event) {
  return prettyJson({
    seq: event.seq,
    requestId: event.requestId,
    toolName: event.toolName,
    result: event.result,
    receivedAt: event.receivedAt,
  });
}

export function errorTitle(event) {
  return event?.error?.message || event?.message || "Error";
}
