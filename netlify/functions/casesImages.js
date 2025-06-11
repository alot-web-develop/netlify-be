const { google } = require("googleapis");
require("dotenv").config();

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.SECURITY_JSON || "{}"),
  scopes: ["https://www.googleapis.com/auth/drive.readonly"],
});

const drive = google.drive({ version: "v3", auth });

exports.handler = async () => {
  try {
    const response = await drive.files.list({
      q: `'${process.env.DRIVE_CASEFOLDER_ID}' in parents and trashed = false`,
      fields: "files(id, name, mimeType)",
    });

    const validExtensions = [
      ".jpg",
      ".jpeg",
      ".png",
      ".webp",
      ".gif",
      ".bmp",
      ".tiff",
      ".heic",
    ];

    const imageFiles = response.data.files.filter((file) => {
      const ext = file.name.toLowerCase().match(/\.[^.]+$/)?.[0];
      return ext && validExtensions.includes(ext);
    });

    const imageList = await Promise.all(
      imageFiles.map(async (file) => {
        try {
          const permissions = await drive.permissions.list({
            fileId: file.id,
            fields: "permissions(type, role)",
          });

          const isPublic = permissions.data.permissions.some(
            (p) => p.type === "anyone" && p.role === "reader"
          );

          if (!isPublic) {
            await drive.permissions.create({
              fileId: file.id,
              requestBody: { role: "reader", type: "anyone" },
            });
          }

          return {
            imgSrc: `https://drive.google.com/thumbnail?id=${file.id}&sz=w1000`,
            alt: file.name.replace(/\.\w+$/, "").replace(/[-_]/g, " "),
          };
        } catch {
          return null;
        }
      })
    );

    return {
      statusCode: 200,
      body: JSON.stringify(imageList.filter(Boolean)),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
