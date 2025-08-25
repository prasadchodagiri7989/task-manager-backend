import { v2 as cloudinary } from "cloudinary";
import streamifier from "streamifier";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export const uploadAudio = async (file) => {
  if (!file) throw new Error("No file provided");

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: "audio_uploads",
        resource_type: "video", // must be 'video' for audio
        timeout: 120000, // 2 min timeout
      },
      (error, result) => {
        if (error) {
          console.error("Cloudinary Upload Error:", error);
          reject(error);
        } else {
          resolve({
            success: true,
            url: result.secure_url,
            public_id: result.public_id,
          });
        }
      }
    );

    // use streamifier to push buffer
    streamifier.createReadStream(file.buffer).pipe(uploadStream);
  });
};
