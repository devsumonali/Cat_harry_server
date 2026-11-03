import { File } from 'node:buffer';

async function upload(req) {
     const key = process.env.IMGBB_API_KEY;
     if (!key || key.startsWith('YOUR_'))
          return Response.json(
               { message: 'Image upload is not configured yet. Please use an image URL.' },
               { status: 503 },
          );
     try {
          if (!Buffer.isBuffer(req.body)) return Response.json({ message: 'Choose an image file.' }, { status: 400 });
          const input = await new Request('http://localhost/api/upload', {
               method: 'POST',
               headers: { 'content-type': req.get('content-type') },
               body: req.body,
          }).formData();
          const file = input.get('image');
          if (
               !(file instanceof File) ||
               !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
               file.size > 5 * 1024 * 1024
          )
               return Response.json(
                    { message: 'Choose a JPG, PNG or WebP image up to 5 MB.' },
                    { status: 400 },
               );
          const form = new FormData();
          form.set('image', file);
          const response = await fetch(
               `https://api.imgbb.com/1/upload?key=${encodeURIComponent(key)}`,
               { method: 'POST', body: form },
          );
          const result = await response.json();
          if (!response.ok || !result.success || !result.data?.url)
               throw new Error('Upload failed');
          return Response.json({ url: result.data.url });
     } catch {
          return Response.json(
               { message: 'Image upload failed. Please try again.' },
               { status: 502 },
          );
     }
}


export async function uploadImage(req, res, next) {
     try {
          const response = await upload(req);
          res.status(response.status).json(await response.json());
     } catch (error) {
          next(error);
     }
}
