// Cloudflare Stream's player in an iframe. Video segments come from Stream's CDN, never from
// our Worker. Only the watch route imports this, so it ships in that route's chunk.
export function StreamPlayer(props: { src: string; title: string }) {
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
      <iframe
        src={props.src}
        title={props.title}
        className="absolute inset-0 size-full border-0"
        allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
      />
    </div>
  )
}
