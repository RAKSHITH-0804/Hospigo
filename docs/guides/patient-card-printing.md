# Patient card printing (2 x 4 inch label)

Printer: TSC TTP-244 Plus (4-inch desktop barcode label printer, 203 DPI, direct thermal or thermal transfer). Label: 2 x 4 inch, about 50 x 100 mm.

## What Hospigo does today (Step 2.1a)

The card is a normal print page with the exact label size (100 x 50 mm landscape, margins 3 mm, set in Settings, Printing, Patient card). It prints through the browser or the Windows printer driver:

1. Install the TSC driver, add the label size 100 x 50 mm as a paper in the driver preferences.
2. In Chrome: Settings, Printing, Patient card: press **Print a test card**. In the print window choose the label printer, paper = the label size, scale 100 percent, margins none, background graphics off.
3. If the text is cut off or shifted, change the margins or the offset in the designer and print the test card again.
4. Settings, OPD rules: switch on **Offer the patient card after payment** only when the printer is ready.

No printer was available to test with, so the first real print needs the test card.

## The raw TSPL option (NOT built)

TSC printers also understand TSPL commands sent straight to the printer (fast, exact, no driver). That needs: a way for the web app to reach the printer (the printer on the reception PC shared by name, or a small print agent installed on that PC, or WebUSB), the printer model confirmed, and a label designed in dots (203 DPI: 2 x 4 inch is 406 x 812 dots). It also needs hardware to test with. Decide this after the first hospital has used the browser print.
