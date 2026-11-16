// Tripboard: MapLibre's right-to-left text plugin (setRTLTextPlugin in
// src/map.js), so Hebrew and Arabic names on the map read in the right
// order and Arabic letters join. MapLibre's worker imports this module
// only once a label needs it. rtl.js and the .wasm are
// @mapbox/mapbox-gl-rtl-text 1.0.0 (BSD-2-Clause, LICENSE.md), unchanged.
// The .wasm is read as bytes and handed over as application/wasm, since
// not every server (server.js) labels it so.
import { createRTL } from "./rtl.js";

const bytes = await (await fetch(new URL("./mapbox-gl-rtl-text.wasm", import.meta.url))).arrayBuffer();
self.registerRTLTextPlugin(await createRTL(new Response(bytes, { headers: { "Content-Type": "application/wasm" } })));
