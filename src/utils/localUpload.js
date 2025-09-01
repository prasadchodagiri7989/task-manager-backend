import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/'); // Ensure this folder exists
  },
    filename: function (req, file, cb) {
      const ext = path.extname(file.originalname);
      cb(null, uuidv4() + ext);
  }
});

const upload = multer({ storage });

export default upload;
