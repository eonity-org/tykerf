# Slicing notation — specification v0.2 (draft)

A shared, textual representation of a web page's layout that **people and AIs use to identify, track and change blocks**. Every block has a name, a kind, a position and a canonical textual form, and every change is a named operation on those names.

Status: **v0.2**
- implemented: sections 1–7b (including box types and scope)
- designed, not yet built: section 8 (change language)

References (inspiration):
- R. H. J. M. Otten, "Automatic floorplan design," *19th Design Automation Conference*, 1982: slicing structures.
- D. F. Wong and C. L. Liu, "A New Algorithm for Floorplan Design," *23rd Design Automation Conference*, 1986, pp. 101–107: normalized Polish expressions and the M1/M2/M3 moves. Longer version: "Floorplan Design of VLSI Circuits," *Algorithmica* 4, 1989.
- L. Stockmeyer, "Optimal orientations of cells in slicing floorplan designs," *Information and Control* 57, 1983: shape functions.
- G. Nagy and S. Seth, "Hierarchical representation of optically scanned documents," *7th ICPR*, 1984: recursive XY-cut (used by the importer).
- Schema-driven component editors: identity separate from labels, typed paths, and a grammar of allowed components (the idea behind box types, section 7).

---

## 1. Concepts

| Term | Meaning |
|---|---|
| **box** (leaf) | A block of content. Its code is `boxes/<name>.html`. |
| **operator** | A box that contains boxes and says how they are arranged. |
| **cut** | Floorplanning convention: the operator letter names the *cut*, not the flow. |
| **name** | The identity and address of a box or operator. Unique in the page. |
| **path** | Where a node is: the names from the root down to it. |
| **move** | A named, validated change to the tree. Moves never produce an invalid tree. |

| Operator | Name for people / AI | Arranges its children | Arity |
|---|---|---|---|
| `V` | row | side by side, left to right (vertical cuts) | n ≥ 2 |
| `H` | column | stacked, top to bottom (horizontal cuts) | n ≥ 2 |
| `W` | wheel | pinwheel: top, right, bottom, left, center | 5 |
| `P` | periphery | frame: north, west, center, east, south (`_` = empty slot) | 5 |

## 2. Grammar (EBNF)

```ebnf
slice       = { line } ;
line        = comment | rule | overlay | expr-part ;          (* expr-parts of all lines form one expression *)
comment     = "//" { any } ;

expression  = term { term } ;                                  (* postfix; must reduce to exactly one tree *)
term        = box | empty | operator ;

box         = name [ "[" box-attr { ws box-attr } "]" ] ;
empty       = "_" ;
operator    = kind [ arity ] [ "@" name ] [ "{" op-attr { ws op-attr } "}" ] ;
kind        = "H" | "V" | "W" | "P" ;
arity       = digit { digit } ;                                (* H/V only; default 2 *)

name        = name-start { name-char } ;                       (* must not match /^[HVWP]\d*$/ *)
name-start  = letter | digit | "_" ;
name-char   = letter | digit | "_" | "." | "-" ;

box-attr    = "type=" type-name                                (* box type, §7 *)
            | "role=" word                                     (* header nav main aside footer section article *)
            | "#" word                                         (* tag *)
            | "shape=" shape { "|" shape }                     (* size hints; alternatives = variants *)
            | "variant=" int
            | "minw=" number                                   (* optimizer hint, not rendered *)
            | "maxw=" number                                  (* rendered: max-width, centered *)
            | "minh=" number ;                                 (* rendered: min-height px; content can still make it taller *)
shape       = "text:" number [ ":" number [ ":" number ] ]     (* chars [: fontPx [: lineHeight]] *)
            | "image:" number                                  (* aspect w/h, also "16/9" *)
            | "fixed:" number ":" number ;                     (* w : h px *)

op-attr     = ratios | "gap=" number | "align=" ( "start" | "center" | "end" | "stretch" )
            | "maxw=" number | "minh=" number | "type=" type-name | "#" word ;
type-name   = lower { lower | digit | "-" } ;
ratios      = number ":" number { ":" number } ;               (* H/V: one per child; W/P: 3 column weights *)

rule        = "rule" ws name ws "below=" number ws
              ( ( "flip" | "hide" ) ws ref | "ratios" ws ref ws ratios ) ;
overlay     = "overlay" ws name ws "on" ws ref
              [ ws "anchor=" anchor ] [ ws "z=" int ] ;
anchor      = "box" | "top" | "bottom" | "left" | "right"
            | "top-left" | "top-right" | "bottom-left" | "bottom-right" ;
```

Example:

```
title[role=header] tabs chart V@row1{gap=16} pricing signup faq V@row2{1:2 gap=16} footer H5@page
rule r1 below=700 flip row2
```

## 3. Semantics

1. **Evaluation.** Read left to right with a stack. A box pushes itself; an operator of arity *n* pops *n* nodes and pushes itself. A valid expression leaves exactly one node, the root.
2. **Ratios.** Relative sizes along the operator's direction. Without ratios, an operator states **topology only**, rendered as an equal split.
   - A row splits its width this way.
   - A column splits its *spare* height the same way when it has any, i.e. inside a row or a fixed-height slot. No child shrinks below its own content.
   - The page root is the exception: it follows normal page flow.
3. **Normalization.** A chain of the same unratioed operator is one n-ary operator: `a b c V V` ≡ `a b c V3`. With ratios, the weights compose.
4. **Order.** The postfix order of boxes is the reading order. The generated DOM follows it, for accessibility.
5. **Rules** apply while the viewport is narrower than `below`; the smallest `below` wins. `flip` on `W`/`P` stacks the slots in reading order.
6. **Overlays** float over their target: `box` = centered; edges and corners = inside that edge or corner.

## 4. Identity

- **The name is the identity.** It is chosen to be readable, because people read and type it.
- Unnamed operators get `o<n>` ids. They are stable once written to the file, but meaningless to people, so give important operators a name.
- **Renaming is an explicit, logged operation.** It rewrites every reference atomically: rules, overlays and the box's code file. Nothing is left pointing at the old name.
- *Planned (v0.2):* an immutable `uid`, separate from the name, so history and external links survive renames.

## 5. References — how people and AIs point at blocks

| Form | Example | Resolves |
|---|---|---|
| name | `faq` | the node with that name |
| path | `page/row2/faq` | each step must be a child of the previous one (verified) |
| path with positions | `row2/2`, `page/4/2` | a number is a 1-based child index; a step that matches a child's name is treated as a name |
| position from the root | `#4.2` | Dewey index path; `#` avoids clashing with numeric names like `29` |
| root | `/` | the root |

- Resolution is exact; there is no fuzzy matching.
- The **canonical reference** returned by tools is the name path, e.g. `page/row2/faq`.
- *Planned (v0.2):* **type paths**, e.g. `page/faq-list`, which match by box type.

## 6. Moves (the change operations)

| Move | Arguments | Effect |
|---|---|---|
| `swap` | a, b | exchange two subtrees (ratios travel with them) |
| `flip` | op | row ↔ column |
| `wrap` | ids…, row/column | group contiguous siblings |
| `unwrap` | op | dissolve into the parent |
| `split` | box, kind, n | turn a box into an operator with new boxes |
| `add_leaf`, `remove`, `move` | … | insert, delete, re-parent |
| `insert_next` | block, row/column, name, before? | new box beside (row) or below (column) any block: a sibling if the parent already runs that way, otherwise the block is wrapped |
| `set_ratios`, `set_op`, `set_leaf`, `set_variant` | … | sizes and attributes |
| `tag`, `untag` | … | tags |
| `attach_overlay`, `detach_overlay` | … | overlays |
| `add_rule`, `remove_rule` | … | responsive rules |
| `rename` | node, new name | rename and rewrite every reference |
| `set_content` | box, html | replace the box's code |

Every move is validated: it either returns a valid tree or is refused. Every applied move is logged with **author** (`user` / `ai`), **time** and the previous state, so it is undoable.

## 7. Box types — implemented (v0.2)

Boxes and operators may have a type: `faq[type=faq-list]`, `V@row2{type=widget-row}`. Each type is defined in `types/<type>.json`, in the style of component schemas.

```json
{
  "label": { "en": "FAQ list", "es": "Preguntas frecuentes" },
  "within": ["main-area"],
  "notWithin": ["site-header"],
  "children": ["widget", "faq-list"],
  "max": 1,
  "content": { "tags": ["h3", "details", "summary", "p", "a"], "scripts": false, "styles": true },
  "template": "templates/faq-list.html"
}
```

| Key | Rule |
|---|---|
| `within` | must have an ancestor of one of these types |
| `notWithin` | must not have an ancestor of these types |
| `children` | (containers) typed blocks inside must be of these types. Untyped rows/columns are transparent, so arranging typed blocks never breaks the container |
| `max` | at most this many in the page |
| `content.tags` / `scripts` / `styles` | what the block's code may contain |
| `template` | starting code for new boxes of this type |

- **Gradual typing:** untyped blocks are not checked.
- **Enforcement** is in the workspace layer, so it applies to every author (AI, editor, CLI). A change may not *introduce* a violation. Box code is checked on every `set_content`.

## 7b. Scope — implemented (v0.2)

- **What a scope is:** a block reference that limits changes to that block's subtree.
- **Who sets it:** the editor, for the block an AI request is about, or the AI with `focus`. A scope set by the user cannot be removed or widened by the AI.
- **How it is enforced:** by comparing everything *outside* the scope before and after each change: the tree with the scope as one opaque box, plus the rules and overlays targeting outside nodes. Because of that, no move (present or future) can slip past it. Box code outside the scope cannot be edited, and undo is refused if it would change something outside.

## 8. Change language (planned, v0.2)

History and AI proposals written in the same notation, one move per line, readable and replayable:

```
swap tabs chart
flip row2
ratios row2 1:2
rename o3 hero
rule r1 below=700 flip row2
```

A change set is a list of such lines. It can be **reviewed** (the affected boxes are highlighted in the editor), **accepted** or **rejected** as a unit, and **replayed** on another copy of the page.
