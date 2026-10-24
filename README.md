# Hand Portions

A tiny offline PWA for logging Precision Nutrition hand portions.

- **Settings:** units (kg/lb) and daily targets for thumbs of fat, cupped palms of carbs, fists of veggies and palms of protein.
- **Add:** pick a date and enter any of weight or portions. Portions add to that day's total (a negative number corrects a mistake); weight replaces that day's weight.
- **Days:** one row per day showing totals against targets.
- **Data:** export all days to CSV (`date,weight_lb|weight_kg,fat,carbs,veggies,protein`, weight in your current units) and import it back. Import replaces days present in the file and leaves the others alone.

Data is stored in IndexedDB on the device: one row per date, updated each time you add. No build step. Serve the folder over HTTPS (e.g. GitHub Pages) and use "Add to Home Screen". To ship changes to installed copies, bump `CACHE` in `sw.js`.

Local: `python3 -m http.server` then open http://localhost:8000.
