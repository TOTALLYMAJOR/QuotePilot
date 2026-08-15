import { forwardRef } from "react";

// QuotePilot uses one deliberately small, stroke-based icon vocabulary across
// the workspace. Keeping the paths local avoids shipping every alternate icon
// weight from a general-purpose icon package while preserving the familiar
// component API used by the product surfaces.
const PATHS = Object.freeze({
  armchair: "M6 11V8.5a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3V11M5 10a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2M6 18v2m12-2v2",
  arrowLeft: "M19 12H5m6-6-6 6 6 6",
  arrowRight: "M5 12h14m-6-6 6 6-6 6",
  arrowSquareOut: "M14 5h5v5m0-5-8 8M18 13v6H5V6h6",
  broadcast: "M8.5 15.5a5 5 0 0 1 0-7m-3 10a9 9 0 0 1 0-13M12 12h.01",
  calendarBlank: "M7 3v3m10-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Z",
  chatCenteredDots: "M5 18.5 3.8 21l4-1.5A9 9 0 1 0 5 18.5ZM8 12h.01M12 12h.01M16 12h.01",
  chatCircle: "M6 18.5 4 21l4-1.4A9 9 0 1 0 6 18.5Z",
  chatCircleDots: "M6 18.5 4 21l4-1.4A9 9 0 1 0 6 18.5ZM8 12h.01M12 12h.01M16 12h.01",
  checkCircle: "M21 12a9 9 0 1 1-4-7.5M8 12l2.5 2.5L20 5",
  clipboardText: "M9 5h6M9 3h6v4H9V3ZM7 5H5v16h14V5h-2M8 11h8m-8 4h8m-8 4h5",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2",
  clockCountdown: "M8 3h8M12 3v3m0 4v3l2 2m4.5-7.5 1.5-1.5M21 14a9 9 0 1 1-3.1-6.8",
  currencyDollar: "M16 8.5c0-1.4-1.8-2.5-4-2.5S8 7.1 8 8.5 9.4 10 12 10s4 .7 4 2.5S14.2 15 12 15s-4-1.1-4-2.5M12 3v16",
  envelopeSimple: "M3 6h18v12H3V6Zm0 1 9 7 9-7",
  filePdf: "M6 3h8l4 4v14H6V3Zm8 0v5h5M8 16h2a2 2 0 0 0 0-4H8v6m6 0v-6h3",
  fileText: "M6 3h8l4 4v14H6V3Zm8 0v5h5M9 12h6m-6 4h6",
  forkKnife: "M7 3v7m-2-7v5a2 2 0 0 0 4 0V3M7 10v11m9 0V3c2 1.5 3 3.5 3 6v3h-3",
  handSwipeLeft: "M9 12V7a1.5 1.5 0 0 1 3 0v4-1.5a1.5 1.5 0 0 1 3 0V12a1.5 1.5 0 0 1 3 0v4c0 3-2 5-5 5h-1c-2 0-3.5-.8-4.5-2.4L4 14.5a1.5 1.5 0 0 1 2.2-2l2.8 2M7 4H3m2-2L3 4l2 2",
  info: "M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Zm0-9v5m0-9h.01",
  listChecks: "m4 7 1.5 1.5L8 6M11 7h9m-16 5 1.5 1.5L8 11m3 1h9m-16 5 1.5 1.5L8 16m3 1h9",
  magnifyingGlass: "M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm6-2 4 4",
  mapPin: "M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Zm-8 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  microphone: "M12 15a4 4 0 0 0 4-4V7a4 4 0 0 0-8 0v4a4 4 0 0 0 4 4Zm7-4a7 7 0 0 1-14 0m7 7v3m-4 0h8",
  minus: "M5 12h14",
  notePencil: "M5 4h10v4M5 4v16h14v-8M8 9h5m-5 4h4m3.5-6.5 2-2a2 2 0 0 1 3 3l-7.5 7.5-3.5.5.5-3.5 7.5-7.5Z",
  package: "m4 7 8-4 8 4-8 4-8-4Zm0 0v10l8 4 8-4V7m-8 4v10",
  pencilSimple: "M4 20h4l11-11a2.1 2.1 0 0 0-3-3L5 17l-1 3Zm10-12 3 3",
  plus: "M12 5v14M5 12h14",
  prohibit: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM5.6 5.6l12.8 12.8",
  sparkle: "m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Zm7 11 .7 2.3L22 17l-2.3.7L19 20l-.7-2.3L16 17l2.3-.7L19 14ZM5 14l.8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8L5 14Z",
  starFour: "m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Zm7 12 .6 1.9 1.9.6-1.9.6L19 20l-.6-1.9-1.9-.6 1.9-.6L19 15Z",
  trashSimple: "M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0",
  userCircle: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-6 6a7 7 0 0 1 12 0",
  userGear: "M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 10-6.3M18 14v2m0 4v2m-4-4h2m4 0h2m-1.2-2.8-1.4 1.4m-2.8 2.8-1.4 1.4m0-5.6 1.4 1.4m2.8 2.8 1.4 1.4M18 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  usersThree: "M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0m1-10a3 3 0 1 0 0-6m1 9a6 6 0 0 1 4 5.7",
  wallet: "M4 6h14a2 2 0 0 1 2 2v11H4a2 2 0 0 1-2-2V7a3 3 0 0 1 3-3h12M15 11h6v5h-6a2.5 2.5 0 0 1 0-5Z",
  warningCircle: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-5v6m0 4h.01",
  xCircle: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-12-3 6 6m0-6-6 6"
});

const makeIcon = (pathKey) => {
  const ProductIcon = forwardRef(function ProductIcon({
    size = 24,
    color = "currentColor",
    weight = "regular",
    mirrored = false,
    style,
    ...props
  }, ref) {
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth={["bold", "fill"].includes(weight) ? 2.35 : 1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
        style={mirrored ? { ...style, transform: `${style?.transform || ""} scaleX(-1)`.trim() } : style}
        data-icon-weight={weight}
        {...props}
      >
        <path d={PATHS[pathKey]} />
      </svg>
    );
  });
  ProductIcon.displayName = `${pathKey}Icon`;
  return ProductIcon;
};

export const Armchair = makeIcon("armchair");
export const ArrowLeft = makeIcon("arrowLeft");
export const ArrowRight = makeIcon("arrowRight");
export const ArrowSquareOut = makeIcon("arrowSquareOut");
export const Broadcast = makeIcon("broadcast");
export const CalendarBlank = makeIcon("calendarBlank");
export const ChatCenteredDots = makeIcon("chatCenteredDots");
export const ChatCircle = makeIcon("chatCircle");
export const ChatCircleDots = makeIcon("chatCircleDots");
export const CheckCircle = makeIcon("checkCircle");
export const ClipboardText = makeIcon("clipboardText");
export const Clock = makeIcon("clock");
export const ClockCountdown = makeIcon("clockCountdown");
export const CurrencyDollar = makeIcon("currencyDollar");
export const EnvelopeSimple = makeIcon("envelopeSimple");
export const FilePdf = makeIcon("filePdf");
export const FileText = makeIcon("fileText");
export const ForkKnife = makeIcon("forkKnife");
export const HandSwipeLeft = makeIcon("handSwipeLeft");
export const Info = makeIcon("info");
export const ListChecks = makeIcon("listChecks");
export const MagnifyingGlass = makeIcon("magnifyingGlass");
export const MapPin = makeIcon("mapPin");
export const Microphone = makeIcon("microphone");
export const Minus = makeIcon("minus");
export const NotePencil = makeIcon("notePencil");
export const Package = makeIcon("package");
export const PencilSimple = makeIcon("pencilSimple");
export const Plus = makeIcon("plus");
export const Prohibit = makeIcon("prohibit");
export const Sparkle = makeIcon("sparkle");
export const StarFour = makeIcon("starFour");
export const TrashSimple = makeIcon("trashSimple");
export const User = makeIcon("user");
export const UserCircle = makeIcon("userCircle");
export const UserGear = makeIcon("userGear");
export const UsersThree = makeIcon("usersThree");
export const Wallet = makeIcon("wallet");
export const WarningCircle = makeIcon("warningCircle");
export const XCircle = makeIcon("xCircle");
