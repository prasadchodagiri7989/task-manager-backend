import 'dotenv/config';
import cloudinary from 'cloudinary';
import multer from 'multer';
import streamifier from 'streamifier';

cloudinary.v2.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const upload = multer();

export const uploadToCloudinary = async (file) => {
  if (!file) throw new Error('No file provided');
  const streamUpload = (file) => {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.v2.uploader.upload_stream(
        { folder: 'uploads', resource_type: 'auto' },  // <-- important
        (error, result) => {
          if (result) {
            resolve(result);
          } else {
            reject(error);
          }
        }
      );
      streamifier.createReadStream(file.buffer).pipe(stream);
    });
  };
  return await streamUpload(file);
};


export default upload;
