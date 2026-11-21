# Third-party notices

**Language:** [Español](./THIRD-PARTY-NOTICES.md) · English

Puntovivo bundles the following assets. Each remains under its own licence.

## Fonts

All three families are bundled into the web and desktop builds through the
Fontsource npm packages, which carry the full licence text.

| Family | Used for | Copyright | Licence |
| --- | --- | --- | --- |
| Instrument Sans | Interface text | Copyright 2022 The Instrument Sans Project Authors (https://github.com/Instrument/instrument-sans) | SIL Open Font License 1.1 |
| Bricolage Grotesque | Titles and money figures | Copyright 2022 The Bricolage Grotesque Project Authors (https://github.com/ateliertriay/bricolage) | SIL Open Font License 1.1 |
| DM Mono | Codes and key caps | Copyright 2020 The DM Mono Project Authors (https://www.github.com/googlefonts/dm-mono) | SIL Open Font License 1.1 |

The SIL Open Font License 1.1 is available at https://openfontlicense.org.
The fonts are used unmodified and are not sold on their own.

## Libraries

Bundled into the web build and loaded only on phones whose browser has no
built-in detector for retail barcodes.

| Library | Used for | Copyright | Licence |
| --- | --- | --- | --- |
| @zxing/library (https://github.com/zxing-js/library) | Reading barcodes with the phone camera | Copyright ZXing authors, ported to TypeScript by the ZXing-JS contributors | Apache License 2.0 |
| ts-custom-error (https://github.com/adriengibrat/ts-custom-error) | Error classes inside @zxing/library | Copyright (c) 2019 Adrien Gibrat | MIT License |

The Apache License 2.0 is available at https://www.apache.org/licenses/LICENSE-2.0.
Both packages are used unmodified; their npm packages carry the full licence text.
