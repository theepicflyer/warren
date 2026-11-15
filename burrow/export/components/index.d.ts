import type { ReactNode, ButtonHTMLAttributes, CSSProperties } from 'react';

type Character = 'bao' | 'kacang' | 'gali' | 'kayu' | 'hamster' | 'squirrel' | 'molerat' | 'beaver';
type Mood = 'happy' | 'joy' | 'busy' | 'sleepy' | 'worried' | 'wow';
type TraceName = 'seed' | 'crumbs' | 'sunflower' | 'berry' | 'acorn' | 'leaf' | 'pinecone' | 'mushroom' | 'footprint' | 'hole' | 'mound' | 'pebble' | 'twig' | 'log' | 'chewed' | 'chips';
type TrailKind = 'crumbs' | 'seeds' | 'acorns' | 'leaves' | 'footprints' | 'chips';
type IconName = 'home' | 'plus' | 'chart' | 'gear' | 'camera' | 'bowl' | 'wallet' | 'search' | 'arrow-up' | 'arrow-down' | 'check' | 'calendar' | 'repeat';
type TagTone = 'plain' | 'in' | 'over' | 'note';

/** One of the four animals. */
export interface MascotProps { character?: Character; mood?: Mood; size?: number; label?: string; bounce?: boolean; className?: string; }
/** A header band: an animal at home. */
export interface HabitatProps { kind: 'meadow' | 'oak' | 'burrow' | 'river'; character?: Character | false; mood?: Mood; size?: number; bounce?: boolean; children?: ReactNode; style?: CSSProperties; className?: string; }
export interface TraceProps { name: TraceName; size?: number; style?: CSSProperties; className?: string; }
/** An animal behind the top edge of its child, paws over the edge. */
export interface PeekProps { character: Character; mood?: Mood; size?: number; edge?: 'top' | 'side'; side?: 'left' | 'right'; offset?: number; children: ReactNode; className?: string; }
/** Traces along a smooth path through the given points. */
export interface TrailProps { kind: TrailKind; points: [number, number][]; width: number; height: number; spacing?: number; fade?: number; done?: number; animate?: boolean; style?: CSSProperties; className?: string; }
/** A trail across the gap between two stacked blocks; from/to are 0..1 of the width. */
export interface TrailGapProps { kind: TrailKind; from?: number; to?: number; height?: number; fade?: number; done?: number; animate?: boolean; className?: string; }
export interface TrailStep { title: ReactNode; sub?: ReactNode; aside?: ReactNode; state?: 'done' | 'current' | 'todo'; mood?: Mood; }
export interface TrailStepsProps { kind?: TrailKind; character?: Character; steps: TrailStep[]; className?: string; }
/** aside: the day's total, on the right of its title. */
export interface TunnelItem { day: ReactNode; month: ReactNode; title?: ReactNode; aside?: ReactNode; children?: ReactNode; }
export interface TunnelProps { items: TunnelItem[]; className?: string; }
export interface BreadcrumbsProps { items: { label: ReactNode; href?: string }[]; kind?: 'crumbs' | 'footprints' | 'acorns'; className?: string; }
export interface DividerProps { kind?: 'seeds' | 'leaves' | 'footprints' | 'twig'; className?: string; }
export interface BackdropProps { pattern?: 'seeds' | 'leaves' | 'soil' | 'ripples' | 'dots'; children?: ReactNode; style?: CSSProperties; className?: string; }
/** cap: an animal (drawn running at the progress point) or a trace name. */
export interface RingProps { value: number; max: number; variant?: 'sunflower' | 'wreath'; cap?: Character | TraceName; capMood?: Mood; capSize?: number; size?: number; color?: string; children?: ReactNode; }
/** Over max, an `over` Tag follows the value; `tag` replaces it with another flag ("over 6×"). */
export interface MeterProps { label: string; value: number; max: number; valueText?: string; color?: string; cap?: TraceName; tag?: ReactNode; tagTone?: TagTone; className?: string; }
/** A sinking fund as a buried acorn stash; 15 acorns = full. */
/** tags: Tags under the balance (the monthly top-up, the target). targetText is kept for older callers and renders as a plain Tag. */
export interface StashProps { name: ReactNode; value: number; max: number; valueText: ReactNode; tags?: ReactNode; targetText?: ReactNode; className?: string; }
/** sub: one line explaining the card, under its title. footer and total: the ruled closing line (a label or hint on the left, a total on the right). */
export interface CardProps { title?: ReactNode; sub?: ReactNode; action?: ReactNode; footer?: ReactNode; total?: ReactNode; tint?: boolean; nibbled?: boolean; children?: ReactNode; className?: string; }
/** Tile, then title over subtitle (the category or meal) and tags, then amount over date (or over detail, the amount's unit). */
export interface ListRowProps { trace?: TraceName; icon?: IconName; leading?: ReactNode; tileColor?: string; title: ReactNode; subtitle?: ReactNode; tags?: ReactNode; amount?: ReactNode; tone?: 'in' | 'over'; date?: Date | ReactNode; detail?: ReactNode; className?: string; }
/** A short fact in a pill. */
export interface TagProps { tone?: TagTone; icon?: IconName; size?: 'lg'; children: ReactNode; className?: string; }
/** A date with the calendar icon. Pass a Date (formatted "Wed 22 Oct") or the text. */
export interface WhenProps { date?: Date | ReactNode; children?: ReactNode; className?: string; }
export interface SegmentedOption { value?: string; label: ReactNode; icon?: IconName; }
/** One of two to four fixed options. */
export interface SegmentedProps { options: SegmentedOption[]; value?: string; onChange?: (value: string) => void; label?: string; className?: string; }
export interface BottomNavItem { id?: string; label: string; icon?: IconName; href?: string; fab?: boolean; }
export interface BottomNavProps { items: BottomNavItem[]; active?: string; peek?: Character; peekMood?: Mood; }
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: 'primary' | 'secondary' | 'ghost'; size?: 'sm'; icon?: IconName; children?: ReactNode; }
export interface ChipProps { selected?: boolean; onClick?: () => void; children: ReactNode; className?: string; }
export interface FieldProps { label: string; id?: string; placeholder?: string; defaultValue?: string; prefix?: ReactNode; suffix?: ReactNode; hint?: string; error?: string; inputMode?: string; type?: string; className?: string; }
export interface LoaderProps { kind?: TrailKind; label?: string; }
export interface EmptyStateProps { character?: Character; mood?: Mood; title: ReactNode; body?: ReactNode; action?: ReactNode; size?: number; className?: string; }
export interface ToastProps { character?: Character; mood?: Mood; children: ReactNode; action?: ReactNode; className?: string; }
export interface IconProps { name: IconName; size?: number; label?: string; className?: string; }
export interface WorldProps { className?: string; }

export declare function Mascot(p: MascotProps): JSX.Element;
export declare function Habitat(p: HabitatProps): JSX.Element;
export declare function Trace(p: TraceProps): JSX.Element;
export declare function Peek(p: PeekProps): JSX.Element;
export declare function Trail(p: TrailProps): JSX.Element;
export declare function TrailGap(p: TrailGapProps): JSX.Element;
export declare function TrailSteps(p: TrailStepsProps): JSX.Element;
export declare function Tunnel(p: TunnelProps): JSX.Element;
export declare function Breadcrumbs(p: BreadcrumbsProps): JSX.Element;
export declare function Divider(p: DividerProps): JSX.Element;
export declare function Backdrop(p: BackdropProps): JSX.Element;
export declare function Ring(p: RingProps): JSX.Element;
export declare function Meter(p: MeterProps): JSX.Element;
export declare function Stash(p: StashProps): JSX.Element;
export declare function Card(p: CardProps): JSX.Element;
export declare function ListRow(p: ListRowProps): JSX.Element;
export declare function Tag(p: TagProps): JSX.Element;
export declare function When(p: WhenProps): JSX.Element;
export declare function BottomNav(p: BottomNavProps): JSX.Element;
export declare function Button(p: ButtonProps): JSX.Element;
export declare function Chip(p: ChipProps): JSX.Element;
export declare function Segmented(p: SegmentedProps): JSX.Element;
export declare function Field(p: FieldProps): JSX.Element;
export declare function Loader(p: LoaderProps): JSX.Element;
export declare function EmptyState(p: EmptyStateProps): JSX.Element;
export declare function Toast(p: ToastProps): JSX.Element;
export declare function Icon(p: IconProps): JSX.Element;
export declare function World(p: WorldProps): JSX.Element;
/** SVG markup strings, for non-React apps. */
export declare function mascotSVG(character: Character, mood: Mood, label?: string): string;
export declare function traceSVG(name: TraceName, size?: number): string;
export declare function trailSVG(opts: Omit<TrailProps, 'animate' | 'style' | 'className'>): string;
/** "Wed 22 Oct"; adds the year when it differs from now's. */
export declare function formatDay(date: Date, now?: Date): string;
export declare const MOODS: Mood[];
export declare function worldSVG(): string;
