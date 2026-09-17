import type { SVGProps } from "react";
import type { Kind } from "@/lib/paths";

type IconProps = SVGProps<SVGSVGElement>;

function Svg({ children, ...props }: IconProps) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

const PAGE = "M4 1.75h5.25L12.5 5v8.25a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2.75a1 1 0 0 1 1-1z";
const FOLD = "M9.25 1.75V5h3.25";

export const MarkIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="2" y="2" width="8.5" height="8.5" rx="1.75" fill="currentColor" stroke="none" />
    <path d="M5.5 14h6.75A1.75 1.75 0 0 0 14 12.25V5.5" stroke="var(--color-accent)" strokeWidth={1.5} />
  </Svg>
);

export const FolderIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M1.75 4.25a1 1 0 0 1 1-1h3.1l1.5 1.5h5.9a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1z" />
  </Svg>
);

export const FileIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d={PAGE} />
    <path d={FOLD} />
  </Svg>
);

export const VideoIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="1.75" y="3.25" width="12.5" height="9.5" rx="1.5" />
    <path d="M6.75 6.1v3.8L10 8z" />
  </Svg>
);

export const AudioIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M2.5 7v2M5 5v6M7.5 2.75v10.5M10 5.25v5.5M12.5 7v2" />
  </Svg>
);

export const ImageIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
    <circle cx="5.5" cy="6.25" r="1.1" />
    <path d="m2.25 12 3.75-3.5 2.5 2.25 2.25-2.25 3 3" />
  </Svg>
);

export const PdfIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d={PAGE} />
    <path d={FOLD} />
    <path d="M5.5 8.5h5M5.5 11h3.5" />
  </Svg>
);

export const TextIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d={PAGE} />
    <path d={FOLD} />
    <path d="m6.5 8.25-1.5 1.5 1.5 1.5M9 8.25l1.5 1.5-1.5 1.5" />
  </Svg>
);

export const ArchiveIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d={PAGE} />
    <path d="M7.75 3.75v1M7.75 6.25v1" />
    <rect x="6.75" y="8.75" width="2" height="2.5" rx=".5" />
  </Svg>
);

const KIND_ICON = {
  folder: FolderIcon,
  video: VideoIcon,
  audio: AudioIcon,
  image: ImageIcon,
  pdf: PdfIcon,
  text: TextIcon,
  archive: ArchiveIcon,
  other: FileIcon,
} satisfies Record<Kind, (props: IconProps) => React.ReactNode>;

export function KindIcon({ kind, ...props }: IconProps & { kind: Kind }) {
  const Icon = KIND_ICON[kind];
  return <Icon {...props} />;
}

export const ExtractIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M9.25 2.25H3.5a1 1 0 0 0-1 1v9.5a1 1 0 0 0 1 1h5.75" />
    <path d="M6.75 8h7" />
    <path d="m11.5 5.75 2.25 2.25-2.25 2.25" />
  </Svg>
);

export const UploadIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M8 10.25V2.5M4.75 5.75 8 2.5l3.25 3.25M2.75 10.25v2a1 1 0 0 0 1 1h8.5a1 1 0 0 0 1-1v-2" />
  </Svg>
);

export const DownloadIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M8 2.5v7.75M4.75 7 8 10.25 11.25 7M2.75 10.25v2a1 1 0 0 0 1 1h8.5a1 1 0 0 0 1-1v-2" />
  </Svg>
);

export const MoveIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M6.5 5.25a1 1 0 0 1 1-1h1.6l1 1h3.15a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1H7.5a1 1 0 0 1-1-1z" />
    <path d="M1.75 8.5h3.5M3.5 6.75 5.25 8.5 3.5 10.25" />
  </Svg>
);

export const FolderPlusIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M1.75 4.25a1 1 0 0 1 1-1h3.1l1.5 1.5h5.9a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1z" />
    <path d="M8 7.25v3.5M6.25 9h3.5" />
  </Svg>
);

export const LinkIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M6.75 9.25a2.5 2.5 0 0 0 3.54 0l2.12-2.12a2.5 2.5 0 0 0-3.54-3.54l-.7.7" />
    <path d="M9.25 6.75a2.5 2.5 0 0 0-3.54 0L3.59 8.87a2.5 2.5 0 0 0 3.54 3.54l.7-.7" />
  </Svg>
);

export const TrashIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M2.75 4.25h10.5M6.25 4.25v-1.5h3.5v1.5M4.25 4.25l.6 8.1a1 1 0 0 0 1 .9h4.3a1 1 0 0 0 1-.9l.6-8.1" />
  </Svg>
);

export const PencilIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M10.25 2.75 13.25 5.75 5.75 13.25H2.75v-3z" />
  </Svg>
);

export const ExternalIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M5.5 10.5l5-5M6.5 5.5h4v4" />
  </Svg>
);

export const ChevronLeftIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M10 3.5 5.5 8l4.5 4.5" />
  </Svg>
);

export const ChevronRightIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="m6 3.5 4.5 4.5L6 12.5" />
  </Svg>
);

export const ArrowUpIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M8 13V3M4 7l4-4 4 4" />
  </Svg>
);

export const SearchIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="7" cy="7" r="4.25" />
    <path d="m10.25 10.25 3 3" />
  </Svg>
);

export const CloseIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Svg>
);

export const CheckIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="m3.5 8.5 3 3 6-7" />
  </Svg>
);

export const LockIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="3.25" y="7" width="9.5" height="6.75" rx="1.25" />
    <path d="M5.25 7V5a2.75 2.75 0 0 1 5.5 0v2" />
  </Svg>
);

export const UnlockIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="3.25" y="7" width="9.5" height="6.75" rx="1.25" />
    <path d="M5.25 7V5a2.75 2.75 0 0 1 5.3-1" />
  </Svg>
);

export const EyeIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M1.75 8S4 3.75 8 3.75 14.25 8 14.25 8 12 12.25 8 12.25 1.75 8 1.75 8z" />
    <circle cx="8" cy="8" r="1.75" />
  </Svg>
);

export const EyeOffIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M6.5 3.9A6 6 0 0 1 8 3.75C12 3.75 14.25 8 14.25 8a11 11 0 0 1-1.6 2.1M10.9 10.95A5.6 5.6 0 0 1 8 12.25C4 12.25 1.75 8 1.75 8a11.3 11.3 0 0 1 2.4-2.85" />
    <path d="M6.75 6.75a1.75 1.75 0 0 0 2.5 2.5M2.25 2.25l11.5 11.5" />
  </Svg>
);

export const KeyIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="5.25" cy="10.75" r="2.5" />
    <path d="m7.1 8.9 5.65-5.65M10.5 5.5l1.75 1.75M12 4l1.5 1.5" />
  </Svg>
);

/** Layout: the details table. */
export const DetailsIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M5.75 4h8M5.75 8h8M5.75 12h8M2.25 4h1M2.25 8h1M2.25 12h1" />
  </Svg>
);

/** Layout: small icons, many to a row. */
export const SmallIconsIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="2.25" y="2.25" width="3" height="3" rx=".5" />
    <rect x="6.5" y="2.25" width="3" height="3" rx=".5" />
    <rect x="10.75" y="2.25" width="3" height="3" rx=".5" />
    <rect x="2.25" y="6.5" width="3" height="3" rx=".5" />
    <rect x="6.5" y="6.5" width="3" height="3" rx=".5" />
    <rect x="10.75" y="6.5" width="3" height="3" rx=".5" />
    <rect x="2.25" y="10.75" width="3" height="3" rx=".5" />
    <rect x="6.5" y="10.75" width="3" height="3" rx=".5" />
    <rect x="10.75" y="10.75" width="3" height="3" rx=".5" />
  </Svg>
);

/** Layout: medium icons. */
export const MediumIconsIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="2.25" y="2.25" width="5" height="5" rx="1" />
    <rect x="8.75" y="2.25" width="5" height="5" rx="1" />
    <rect x="2.25" y="8.75" width="5" height="5" rx="1" />
    <rect x="8.75" y="8.75" width="5" height="5" rx="1" />
  </Svg>
);

/** Layout: large icons — one picture with its name under it. */
export const LargeIconsIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="2.25" y="2.25" width="11.5" height="8.5" rx="1.25" />
    <path d="M4.5 13.25h7" />
  </Svg>
);

export const SortByIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M2.5 4.25h11M4.5 8h7M6.5 11.75h3" />
  </Svg>
);

export const MoreIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="3.75" cy="8" r="1" fill="currentColor" stroke="none" />
    <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
    <circle cx="12.25" cy="8" r="1" fill="currentColor" stroke="none" />
  </Svg>
);

export const SortIcon = ({ descending, ...props }: IconProps & { descending?: boolean }) => (
  <Svg {...props} width={12} height={12}>
    <path d={descending ? "m4.5 6.5 3.5 3.5 3.5-3.5" : "m4.5 9.5 3.5-3.5 3.5 3.5"} />
  </Svg>
);
