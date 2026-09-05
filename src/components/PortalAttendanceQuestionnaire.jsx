import { AttendanceInteraction } from "./QuoteAttendancePanel";
export default function PortalAttendanceQuestionnaire(props) {
  return <div data-capability-id="portal-final-guest-count"><AttendanceInteraction key={JSON.stringify([props.portalKey, props.expectedSourceVersionId, props.expectedPortalIssuedAtISO, props.enabled])} {...props} portal /></div>;
}
