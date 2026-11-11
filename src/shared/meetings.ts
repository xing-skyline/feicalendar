import type { CalendarEvent } from "./types";

export function meetingLink(event: CalendarEvent): string | undefined {
  const links =
    `${event.location}\n${event.description}\n${event.url || ""}`.match(
      /https:\/\/[^\s<>"，。；）)]+/g,
    ) || [];
  return links.find((value) => {
    try {
      const host = new URL(value).hostname;
      return [
        "zoom.us",
        "teams.microsoft.com",
        "teams.live.com",
        "meet.google.com",
        "meeting.tencent.com",
        "voovmeeting.com",
        "vc.feishu.cn",
        "vc.larksuite.com",
        "webex.com",
      ].some((domain) => host === domain || host.endsWith(`.${domain}`));
    } catch {
      return false;
    }
  });
}
