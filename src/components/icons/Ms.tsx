export default ({ ...props }) => {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 23 23" {...props}>
      <path d="M1 1H11V11H1V1Z" fill="var(--color-accent)"/>
      <path d="M12 1H22V11H12V1Z" fill="color-mix(in srgb, var(--color-accent) 72%, white)"/>
      <path d="M1.5 12H11.5V22H1.5V12Z" fill="color-mix(in srgb, var(--color-accent) 68%, black)"/>
      <path d="M12.5 12H22.5V22H12.5V12Z" fill="var(--color-muted)"/>
    </svg>
  )
}
