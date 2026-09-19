# Third-party licenses

Timeline itself is licensed under the Apache License 2.0 (see `LICENSE` and
`NOTICE`). It depends on the open source packages below, which are downloaded
at build time by pip and npm rather than vendored in this repository. Each stays
under its own license, reproduced in full inside the installed package
(`site-packages/<name>-<version>.dist-info/` for Python, `node_modules/<name>/`
for JavaScript). This file preserves the attribution those licenses require
when Timeline is redistributed, for example as a built container image.

Versions are the ranges pinned in `backend/requirements.txt` and
`frontend/package.json`; the installed versions may be newer within those
ranges.

## Backend (Python)

| Package | License | Copyright / author | Source |
|---|---|---|---|
| Django | BSD-3-Clause | Django Software Foundation and individual contributors | https://github.com/django/django |
| djangorestframework | BSD-3-Clause | Encode OSS Ltd. (Tom Christie) | https://github.com/encode/django-rest-framework |
| django-cors-headers | MIT | Otto Yiu and contributors | https://github.com/adamchainz/django-cors-headers |
| djangorestframework-simplejwt | MIT | David Sanders and contributors | https://github.com/jazzband/djangorestframework-simplejwt |
| drf-nested-routers | Apache-2.0 | Alan Justino et al. | https://github.com/alanjds/drf-nested-routers |
| drf-spectacular | BSD-3-Clause | T. Franzel | https://github.com/tfranzel/drf-spectacular |
| django-environ | MIT | Daniele Faraglia and contributors | https://github.com/joke2k/django-environ |
| psycopg (with `binary` extra) | LGPL-3.0-only | Daniele Varrazzo and the Psycopg Team | https://github.com/psycopg/psycopg |
| gunicorn | MIT | Benoit Chesneau | https://github.com/benoitc/gunicorn |
| whitenoise | MIT | David Evans | https://github.com/evansd/whitenoise |
| icalendar | BSD-2-Clause | Plone Foundation and contributors | https://github.com/collective/icalendar |
| python-dateutil (via icalendar) | Apache-2.0 / BSD-3-Clause (dual) | Gustavo Niemeyer, Paul Ganssle and contributors | https://github.com/dateutil/dateutil |
| six (via python-dateutil) | MIT | Benjamin Peterson | https://github.com/benjaminp/six |
| tzdata (via icalendar) | Apache-2.0 | Python Software Foundation | https://github.com/python/tzdata |
| python-pptx | MIT | Steve Canny | https://github.com/scanny/python-pptx |
| lxml (via python-pptx) | BSD-3-Clause | lxml dev team; bundles libxml2 and libxslt (MIT) | https://github.com/lxml/lxml |
| Pillow (via python-pptx) | MIT-CMU (HPND) | Jeffrey A. Clark and contributors; Secret Labs AB; Fredrik Lundh | https://github.com/python-pillow/Pillow |
| XlsxWriter (via python-pptx) | BSD-2-Clause | John McNamara | https://github.com/jmcnamara/XlsxWriter |
| typing_extensions (via python-pptx) | PSF-2.0 | Python Software Foundation | https://github.com/python/typing_extensions |

psycopg is used unmodified as a library. Its LGPL terms apply to psycopg
itself; Timeline's own code is not derived from it. If you redistribute a build
of Timeline, keep psycopg replaceable (it is installed from PyPI at build time)
and include its license text, which ships in the package.

## Frontend (JavaScript)

| Package | License | Copyright | Source |
|---|---|---|---|
| react | MIT | Copyright (c) Facebook, Inc. and its affiliates (now Meta Platforms, Inc.) | https://github.com/facebook/react |
| react-dom | MIT | Copyright (c) Facebook, Inc. and its affiliates (now Meta Platforms, Inc.) | https://github.com/facebook/react |
| react-router-dom | MIT | Copyright (c) React Training LLC 2015-2019, Remix Software 2020-present | https://github.com/remix-run/react-router |
| @dnd-kit/core | MIT | Copyright (c) 2021, Claudéric Demers | https://github.com/clauderic/dnd-kit |
| @dnd-kit/sortable | MIT | Copyright (c) 2021, Claudéric Demers | https://github.com/clauderic/dnd-kit |
| @dnd-kit/utilities | MIT | Copyright (c) 2021, Claudéric Demers | https://github.com/clauderic/dnd-kit |
| vite (dev/build only) | MIT | Copyright (c) 2019-present, VoidZero Inc. and Vite contributors | https://github.com/vitejs/vite |
| @vitejs/plugin-react (dev/build only) | MIT | Copyright (c) 2019-present, Yuxi (Evan) You and Vite contributors | https://github.com/vitejs/vite-plugin-react |

`vite` and `@vitejs/plugin-react` run at build time only; nothing from them
ships in the built frontend bundle. Transitive npm dependencies are all under
MIT, ISC, BSD, 0BSD, or Apache-2.0 terms, plus browser-support data from
`caniuse-lite` under CC-BY-4.0.

## Runtime images

The Docker images are built on the official `python`, `node`, `nginx`, and
`postgres` images from Docker Hub, each under its own license and the licenses
of the software it contains. PostgreSQL is under the PostgreSQL License; nginx
is under the 2-clause BSD license.

## License texts

Full texts of the licenses referenced above:

- Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0
- BSD 3-Clause: https://opensource.org/license/bsd-3-clause
- MIT: https://opensource.org/license/mit
- BSD 2-Clause: https://opensource.org/license/bsd-2-clause
- MIT-CMU (HPND): https://spdx.org/licenses/MIT-CMU.html
- PSF 2.0: https://spdx.org/licenses/PSF-2.0.html
- GNU LGPL 3.0: https://www.gnu.org/licenses/lgpl-3.0.html
- PostgreSQL License: https://www.postgresql.org/about/licence/
