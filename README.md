# Sky

Hold your phone up to the sky: the camera shows it, and this page names every star, constellation, planet and satellite in view. Point it at the ground to see the sky on the other side of the Earth.

Open it at **https://lienardquentin.github.io/sky/** on a phone, tap *Start with the camera*, and allow the camera, motion sensors and location. Everything is computed on the phone; nothing is sent anywhere.

Tap the magnifier to find anything by name (an arrow at the edge shows which way to turn), and tap the time to see the sky up to a day earlier or later.

If the labels sit beside the real stars (phone compasses are off by a few degrees), tap the crosshair button and drag sideways until they line up. If the drawn sky looks bigger or smaller than the camera's, change *Camera zoom* in the layers menu.

## Credits

- Star, constellation and star-name data: [d3-celestial](https://github.com/ofrohn/d3-celestial) by Olaf Frohn (BSD 3-Clause, see `LICENSES/d3-celestial.txt`), from the Yale Bright Star and Hipparcos catalogues.
- Satellite orbits: [CelesTrak](https://celestrak.org) (fetched at most every 6 hours; `data/visual.tle` and `data/aerospacelab.tle` are fallback copies), propagated with [satellite.js](https://github.com/shashwatak/satellite-js) (MIT, header of `lib/satellite.min.js`).
- Positions of the Sun, Moon and planets, and the sky's rotation: [Astronomy Engine](https://github.com/cosinekitty/astronomy) by Don Cross (MIT, header of `lib/astronomy.browser.min.js`).
