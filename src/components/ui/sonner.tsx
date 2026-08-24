"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { useAppearance } from "@/components/theme/theme-provider"

const Toaster = ({ ...props }: ToasterProps) => {
  // v1 read this from next-themes; v2 has its own store, and it hands over the
  // already-resolved mode so sonner never has to re-check the OS itself.
  //
  // `resolved`, not `theme`: since themes took over the whole surface, `theme`
  // is the palette name — sonner would have been handed "forest" and fallen
  // back to its own light default, on a dark app.
  const { resolved } = useAppearance()

  return (
    <Sonner
      theme={resolved}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--panel)",
          "--normal-text": "var(--ink)",
          "--normal-border": "var(--hairline)",
          "--border-radius": "var(--radius-well)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
