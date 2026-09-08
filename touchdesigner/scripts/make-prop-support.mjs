import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const destination = path.resolve(scriptDirectory, "../assets/prop-support.png");

const support = Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
    <rect width="1200" height="800" fill="black" />
    <g fill="white" stroke="white" stroke-linecap="round" stroke-linejoin="round">
      <path
        d="M610 800 L615 710 C620 680 631 656 648 646 C639 625 647 607 668 602
           C684 596 699 607 706 619 C718 607 740 611 751 629
           C768 625 787 637 790 655 C809 661 820 680 816 704 L805 800 Z"
        stroke-width="8"
      />
      <path d="M681 690 L644 554" fill="none" stroke-width="12" />
      <path d="M760 710 L800 560" fill="none" stroke-width="15" />
      <ellipse cx="803" cy="553" rx="8" ry="13" transform="rotate(18 803 553)" />
    </g>
  </svg>
`);

await sharp(support).grayscale().png({ compressionLevel: 9 }).toFile(destination);
console.log(destination);
