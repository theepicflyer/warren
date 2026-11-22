Burrow is the shared look for the household's apps: **makan** (food and macros) and **money** (spending and budgets). Clean, modern layouts carry the data. A cast of small mammals lives around that data in one shared ecosystem, and each animal leaves natural things behind in the interface (seeds, crumbs, acorns, footprints, twigs) that also lead your eye through each screen.

## Principles

1. **Data stays calm, the world plays around it.** Numbers, forms, lists and navigation are plain and clear. The animals, their habitats and their traces live at the edges: headers, corners, dividers, meter tips, the gaps between cards, empty screens, loading.
2. **Every animal has a job in every app.** Each app has a host animal and a home colour (`accent`); the other animals turn up for the same jobs in both apps.
3. **Traces, not just colour.** An animal's presence shows through what it leaves: Bao's bites, seeds and crumbs, Kacang's acorns and leaves, Gali's holes and footprints, Kayu's twigs, logs and chips.
4. **Trails lead somewhere.** Every screen has one trail, and it ends at the one thing that matters now.
5. **Only natural things.** Illustrations show animals, plants, soil, water and what animals make from them. No machines, tools or man-made props (no wheels, jars, signs).
6. **Stickers, not glass.** Animals and art have a thick ink outline and a thin cream rim; controls have a 2px `outline` and a hard `shadow-sticker`. No gradients, blur or glow.
7. **Kind, never preachy.** Going over a target is information, not a failure.
8. **Every fact has a place.** Each kind of information has one place and one look, the same in both apps: the category in the tile and under the title, values on the right, the date under the value, short facts in slots. Nothing sits on a screen as a loose line of grey text.

## The cast

| Animal | Name | Home | Accessories and traces | Jobs (in both apps) |
| --- | --- | --- | --- | --- |
| Syrian hamster | **Bao** | makan; the meadow | stuffed cheek pouches, pink hands, sunflower seeds, crumbs, sunflowers, berries, bite marks | host of makan; food logged, daily goal, macros |
| Red squirrel | **Kacang** | money; the oak | ear tufts, white eye rings, feathery tail, acorns, oak leaves, pinecones, mushrooms, buried stashes | host of money; budgets, savings, sinking funds |
| Naked mole rat | **Gali** | the burrow, under everything | big incisors, wrinkles, digging claws, holes, dirt mounds, muddy footprints, tunnels, pebbles | search, history, loading, sync, "nothing found" |
| Beaver | **Kayu** | the river | orange incisors, whisker pads, scaly paddle tail, branches, logs, chew marks, wood chips | settings, editing, saving, fixing errors |

The animals are drawn with real anatomy (heads, limbs, feet, two-tone fur, whiskers) in a sticker style. Use the Mascot component or the SVGs in the Characters asset group (`bao-joy.svg`, `gali-busy.svg`…).

- Six moods map to moments: `happy` idle, `joy` a win, `busy` working on something (each animal's own action: Bao nibbling, Kacang digging, Gali tunnelling, Kayu chewing), `sleepy` empty or nothing yet, `worried` over budget or something went wrong, `wow` a surprise or record.
- Pick the animal by job, then the mood by moment: a search with no results is Gali `worried`; a save in progress is Kayu `busy`; lunch logged is Bao `joy`.
- At most one full-size animal per screen (72–120px, in a Habitat header, a Peek or an EmptyState). Small appearances (toasts, the current stop of a TrailSteps, the nav peek) can sit alongside it.
- Never recolour, crop, rotate (except the side Peek's lean), or put text on an animal, and never place one inside a chart's data area.

## Where the animals show up

- **Habitat headers.** Top-level screens open with their animal's home: makan Today = `meadow` (Bao, sunflowers, berries), money Home and Budgets = `oak` (Kacang, branch, acorns, a mushroom), History and Search = `burrow` (Gali, soil, roots, footprints), Settings = `river` (Kayu, reeds, a log dam, a lily pad).
- **Peek.** An animal sits behind the top edge of a card or the BottomNav with its paws over the edge, or leans around a card's right edge (`edge="side"`). One Peek per screen, on the card that matters most now.
- **Hero numbers.** makan's day is a sunflower: a petal opens for each share of the target eaten, and the seed head shows what's left (Ring `variant="sunflower"`). money's month is an oak wreath: a leaf turns green for each share spent, with acorns at its base (Ring `variant="wreath"`).
- **Meters.** Macro meters end in a sunflower (`cap="sunflower"`); budget meters end in an acorn (`cap="acorn"`). Every meter shares one scale with the target tick at 80%, so over-target meters look like the others (Meter).
- **Sinking funds** are Kacang's buried stashes, acorns piled to the share of the target (Stash).
- **Logged meals** get a bite out of the card corner and a few crumbs (Card `nibbled`).
- **List tiles** use a trace instead of a generic icon where one fits: seed, crumbs or berry for food; acorn, leaf or pinecone for money.
- **Dividers** are trails: `seeds` between meals, `leaves` between months, `footprints` between days, `twig` between settings groups.
- **Page backgrounds** match the habitat: `seeds`, `leaves`, `soil` or `ripples` (Backdrop).
- **The World** shows all four homes together, for login, onboarding and the About page.

## Where information goes

A glance should tell you what something is before you read it, so each kind of fact always lands in the same place. If a sentence or a number has no place below, give it one; don't leave it floating.

| Fact | Its place | Component |
| --- | --- | --- |
| What an entry is | the row's tile: the category's trace or icon | ListRow `trace` / `icon` |
| Its name | the row's title | ListRow `title` |
| Its category or meal | under the title, then any Tags | ListRow `subtitle`, `tags` |
| Its value | on the right, `body-strong`, with its unit | ListRow `amount` |
| Its date | under the value, with the `calendar` icon | ListRow `date` (When) |
| A food's protein, carbs, fat and energy | line 2 of its row, after the portion, each number right after its symbol in a fixed slot, kcal rightmost | ListRow `macros` and `kcal` (Macros) |
| A meal's totals | a ruled row under its foods, in the same columns | ListRow `total` |
| A card's actions (Add, Save meal) | the tinted tray along its bottom edge | Card `tray` |
| What an assistant's reply changed | a card under the reply, one food row per change | ChangeCard |
| A value's unit or comparison | under the value instead of a date: "a month", "saved", "of S$ 350" | ListRow `detail` |
| A per-month amount, a target, a status, a flag | a slot (a small recess in the surface) | Tag |
| The screen's one number | the Habitat title ("S$ 690 left") | Habitat |
| Other header facts | a row of Tags under the title | `bh-facts` |
| How the period is going | one large Tag under the Ring | Tag `size="lg"` |
| What a card is for | one line under its title | Card `sub` |
| A card's total, closing advice or action | its ruled footer | Card `footer`, `total` |
| A day in history | a Tunnel chamber (day and month), its total on the right | Tunnel `aside` |
| One of two to four fixed options | a segmented switch | Segmented |
| Filters, or a pick from a long list | chips | Chip |

- **Dates** have one format, "Wed 22 Oct", with the year added when it is not this year; "Today" and "Yesterday" may replace it, and a time follows when it matters ("Today 12:40"). A date always carries the `calendar` icon (When) or sits in a Tunnel chamber with its month. Never show a bare day number.
- **Never join facts with a dot.** "Mon 9 Nov · Gym", "Lunch · 719 kcal" and "S$ 125 saved · +S$ 150 a month" each become separate places: a date under the value, a total in the footer, a Tag.
- **Per-month amounts are always Tags**: a fund's top-up "+S$ 110 a month" is an `in` Tag; a budget's "S$ 700 a month" is a `plain` Tag in a header, or the row value with "a month" as its `detail`.
- **Values always carry their unit**: "380 kcal", "S$ 5.50", "6 of 7 months". Never a bare number beside a word. Where a row has no room, a symbol that names the unit may stand in for it (makan's nutrient symbols right before a row's macros and calories).
- **Tags are for reading, Chips and Segmented options for tapping.** Don't make a Tag clickable.

## Wayfinding: trails

Trails are the main way the world helps people use the screen. They connect the parts of a dashboard in the order you should read them and end at the next action.

- **One trail per screen, one destination.** Start at the hero (the ring or the header animal) and end at the next action: the meal to log, the stash to fill, the next day in history. Don't branch.
- **The trail kind follows the app:** `crumbs` (or `seeds`) in makan, `acorns` (with the odd leaf) in money, `footprints` in history and search, `chips` in settings.
- **Faint to strong.** Traces start at about half strength and reach full strength at the destination. Completed parts of a journey are full strength; parts still ahead are faint (`done`).
- **Between cards:** TrailGap, a short trail crossing the gap between two stacked blocks, from where one ends to where the next begins. Alternate sides so the trail zigzags down the page.
- **Through a list of steps:** TrailSteps. Done stops show the trace, the current stop shows the animal, later stops are empty dashed circles. Use for the day's meals, setup checklists and onboarding.
- **Through time:** Tunnel. History is a tunnel with one chamber per day and footprints walking between chambers.
- **Through levels:** Breadcrumbs, with real crumbs (or footprints, or acorns) between the levels.
- **While waiting:** Loader, the same traces stepping across.
- Trails never cross text or data, never replace a button, and stop under reduced motion (they still show, they just don't animate).

The three Dashboard examples (makan Today, money Home, History) show these rules on full screens, with notes on how the eye moves.

## Voice and copy

- Plain, short, second person: "You have 760 kcal left." Sentence case everywhere, including buttons and titles.
- Buttons are a verb plus object: "Log dinner", "Add spend", "Stash S$ 140".
- Confirm with the result: "Lunch logged: 719 kcal", not "Success!".
- Animals may be named in empty states, loading and celebrations, at most once per message: "Gali dug everywhere. Try a shorter word." "Digging up September…"
- One light joke at most, never in errors, numbers or warnings. Errors say what happened and what to do: "Couldn't save. Check your connection and try again."
- Money: `S$ 5.50` with a space; money out has a minus sign, money in a plus. Food: `607 kcal`, `62 g`.
- Dates: `Wed 22 Oct` everywhere, `Wed 22 Oct 2025` outside this year. Per-month amounts: `+S$ 110 a month`.
- Short facts are a few words in a Tag ("Paused", "Target S$ 4,500"), not a sentence. A sentence that explains a card goes under its title; one that closes it goes in its footer.
- No emoji in UI text. The animals carry emotion.

## Colour

- Page: `paper`. Cards, sheets and the nav: `surface`. Tracks and wells: `surface-sunk`. Dividers: `line` (decorative only).
- Text: `ink` for content, `ink-muted` for secondary text, captions and input borders. Both pass 4.5:1 on `paper`, `surface` and `surface-sunk` in both themes.
- `accent` is the app's home colour: makan uses `tomato`, money uses `mint` (add class `bh-app--money` on the root, or re-point `--accent` and `--accent-soft`).
- Habitat skies: `sunny-soft` (meadow), `mint-soft` (oak), `surface-sunk` (burrow), `sky-soft` (river). Ground: `grass`, `soil`, `soil-deep`, `water`, `bark`. These are decorative; text never sits on `grass`, `soil` or `water`.
- Text on the sunflower's seed head and in tunnel chambers is fixed cream #fff4e2 on fixed browns, the same in both themes.
- Text and icons on any bright fill (`accent`, `tomato`, `mint`, `sunny`, `sky`) use `on-accent`, never white.
- Meaning colours always come with a word or sign: `tomato-text` + "over", `mint-text` + "+". Money out stays `ink`.
- Tag fills (in a sunk slot, `shadow-slot`): `surface-sunk` with `ink` (plain), `mint-soft` with `mint-text` (money in, top-ups), `tomato-soft` with `ink` (over; `tomato-text` there is under 4.5:1 in light), `sunny-soft` with `ink` (a heads-up). In a Habitat header every Tag sits on `surface`.
- Macros: `protein` (sky), `carbs` (sunny), `fat` (mint), always labelled. `energy` (tomato) colours the flame. Their soft fills (`protein-soft`, `carbs-soft`, `fat-soft`) stripe a Meter past its target. Always in the order protein, carbs, fat, then energy.
- Links and the focus ring: `sky-text`, a solid 3px outline with 2px offset.
- Animals and traces keep their own fixed colours (`fur-hamster`, `fur-squirrel`, `skin-molerat`, `fur-beaver`) in both themes.

## Type

- Display face **Fredoka** for `hero-number`, `page-title` and `card-title`. Text face **Figtree** for `body`, `body-strong`, `small` and `label`. Both load from Google Fonts.
- Every number that can change uses tabular figures (class `bh-num`).

## Shape, space and depth

- Corners: `radius-lg` for cards, sheets and habitat headers, `radius-sm` for inputs and tiles, `radius-slot` for Tags, `radius-pill` for buttons, chips, meters and the nav.
- Spacing: `space-4` page gutter and card padding; between stacked cards use a TrailGap (40–56px) where a trail runs, otherwise `space-3`.
- Depth: `shadow-lift` for things that float, `shadow-sticker` for things you press.
- Outlines: `border-sticker` (2px) in `outline` on controls; art uses a 2.8px outer ink outline with a cream rim and 1–2px inner lines.

## Motion

- Springy, quick and small: 150–350ms, overshoot easing `cubic-bezier(.34, 1.56, .64, 1)` for meters, petals, leaves and toasts.
- Trails draw in step by step (70ms apart) when a screen opens. Buttons press 3px into their shadow. Idle animals may bob (`bounce`).
- Everything decorative stops under `prefers-reduced-motion`.

## Iconography

- Navigation and actions use round-capped stroke icons (Icon component), 2.2 stroke on a 24 grid, in `currentColor`. For anything missing, use Phosphor Icons Bold.
- Two icons mark kinds of facts: `calendar` before every date, `repeat` before how often something recurs ("Monthly").
- Nutrients are marked with their sticker symbols (Nutrient): a flame for energy, a drumstick for protein, an ear of wheat for carbs, a drop for fat. Never letters (P, C, F) or colour dots. The same symbols appear in rows, Meters, Tags, charts and the chat.
- Content uses traces (Trace component): small natural objects that belong to an animal. A trace is never a button by itself.
- No emoji as icons.

## Layout

- Phone first: single column, `space-4` gutters, a floating BottomNav with the main "add" action as the centre FAB and the host animal peeking over it.
- Home screen order: Habitat header, the Ring with its status Tag, then cards joined by one trail, ending at the next action.
- Inside a card: title (and its `sub`), rows, then the ruled footer. Lists of entries use ListRow everywhere, so the same facts sit in the same places on every screen.

## Using it in each app

`components/bundle.css` is plain CSS classes (`bh-btn`, `bh-card`, `bh-habitat`, `bh-steps`…) built on the token variables, so it drops into SvelteKit (makan) and Django templates (money) without React. Art comes as SVG files (asset groups Characters and Traces) or as strings from `Burrow.mascotSVG(name, mood)`, `Burrow.traceSVG(name, size)`, `Burrow.trailSVG({kind, points, width, height})` and `Burrow.worldSVG()`. The React components in `components/bundle.js` render the same classes and serve as reference markup.
