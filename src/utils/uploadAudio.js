import { v2 as cloudinary } from "cloudinary";

// configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export const uploadAudio = async (fileBuffer) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: "video", // audio must use 'video'
        folder: "audio_uploads",
      },
    //   {timeout:60000},
      (error, result) => {
        if (error) {
          console.error("Cloudinary Audio Upload Error:", error);
          return reject({ success: false, error: error.message });
        }
        resolve({
          success: true,
          url: result.secure_url,
          public_id: result.public_id,
        });
      }
    );

    // push the buffer into the stream
    uploadStream.end(fileBuffer);
  });
};
