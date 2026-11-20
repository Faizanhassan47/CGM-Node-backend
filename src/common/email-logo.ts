import { existsSync } from "fs";
import { join } from "path";

/** CID referenced by email HTML: <img src="cid:circle-mark" /> */
export const CIRCLE_LOGO_CID = "circle-mark";

/** Nodemailer inline attachment for the centered Circle mark. */
export function circleLogoAttachment():
  | {
      filename: string;
      path: string;
      cid: string;
      contentType: string;
      contentDisposition: "inline";
    }
  | undefined {
  const candidates = [
    join(__dirname, "..", "assets", "email", "circle-mark-112.png"),
    join(process.cwd(), "assets", "email", "circle-mark-112.png"),
    join(process.cwd(), "src", "assets", "email", "circle-mark-112.png"),
    join(process.cwd(), "circle_mark.png"),
    join(__dirname, "..", "..", "assets", "email", "circle-mark-112.png"),
    join(__dirname, "..", "..", "circle_mark.png"),
  ];
  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) return undefined;
  return {
    filename: "circle-mark.png",
    path,
    cid: CIRCLE_LOGO_CID,
    contentType: "image/png",
    contentDisposition: "inline",
  };
}
