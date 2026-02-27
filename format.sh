mkdir output
for f in *.gif; do
  ffmpeg -i "$f" -c:v libvpx-vp9 -pix_fmt yuva420p -vf "scale='if(gt(iw,ih),512,-1)':'if(gt(iw,ih),-1,512)'" -r 30 -t 3 -an "output/${f%.gif}.webm"
done
