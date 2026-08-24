'use client'

import { Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export type TimelineStep = {
  status: string
  label: string
  description?: string
  timestamp?: string | null
  isActive?: boolean
  isCompleted?: boolean
  isCanceled?: boolean
  annotation?: string | null
}

interface StatusTimelineProps {
  steps: TimelineStep[]
  className?: string
}

export function StatusTimeline({ steps, className }: StatusTimelineProps) {
  const mainSteps = steps.filter((s) => !s.isCanceled)
  const canceledSteps = steps.filter((s) => s.isCanceled && s.isActive)
  const isCompact = mainSteps.length > 5

  return (
    <div className={cn('w-full', className)}>
      {/* Horizontal stepper */}
      <div className="flex items-start justify-between gap-0">
        {mainSteps.map((step, index) => {
          const isLast = index === mainSteps.length - 1
          const circleSize = isCompact ? 'w-6 h-6' : 'w-7 h-7'
          const connectorTop = isCompact ? 'top-3' : 'top-3.5'
          return (
            <div key={step.status} className="flex-1 flex flex-col items-center relative">
              {/* Connector line (before circle) */}
              {index > 0 && (
                <div
                  className={cn(
                    `absolute ${connectorTop} right-1/2 w-full h-0.5`,
                    step.isCompleted
                      ? 'bg-primary'
                      : step.isActive
                        ? 'bg-green-500'
                        : 'bg-muted-foreground/20'
                  )}
                  style={{ zIndex: 0 }}
                />
              )}
              {/* Connector line (after circle) */}
              {!isLast && (
                <div
                  className={cn(
                    `absolute ${connectorTop} left-1/2 w-full h-0.5`,
                    mainSteps[index + 1]?.isCompleted
                      ? 'bg-primary'
                      : mainSteps[index + 1]?.isActive
                        ? 'bg-green-500'
                        : 'bg-muted-foreground/20'
                  )}
                  style={{ zIndex: 0 }}
                />
              )}

              {/* Circle */}
              <div
                className={cn(
                  `relative z-10 flex items-center justify-center ${circleSize} rounded-full border-2 transition-colors`,
                  step.isCompleted
                    ? 'bg-primary border-primary text-primary-foreground'
                    : step.isActive
                      ? 'bg-green-500/10 border-green-500 text-green-600 ring-4 ring-green-500/20'
                      : 'bg-background border-muted-foreground/30 text-muted-foreground'
                )}
              >
                {step.isCompleted ? (
                  <Check className={isCompact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
                ) : step.isActive ? (
                  <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                ) : (
                  <span className="text-[10px] font-medium">{index + 1}</span>
                )}
              </div>

              {/* Label */}
              <p
                className={cn(
                  'mt-1.5 font-medium text-center leading-tight',
                  isCompact ? 'text-[10px]' : 'text-xs',
                  step.isCompleted || step.isActive
                    ? 'text-foreground'
                    : 'text-muted-foreground'
                )}
              >
                {step.label}
              </p>

              {/* Annotation (e.g. "Revision" badge) */}
              {step.annotation && (
                <span className="text-[9px] font-medium text-amber-600 bg-amber-50 dark:bg-amber-950/30 px-1.5 py-0.5 rounded mt-0.5">
                  {step.annotation}
                </span>
              )}

              {/* Timestamp */}
              {step.timestamp && (
                <p className="text-[10px] text-muted-foreground text-center mt-0.5">
                  {new Date(step.timestamp).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                </p>
              )}
            </div>
          )
        })}
      </div>

      {/* Canceled / Lost indicators */}
      {canceledSteps.map((step) => (
        <div key={step.status} className="flex items-center gap-2 mt-3 px-2 py-1.5 bg-destructive/10 rounded-md">
          <div className="flex items-center justify-center w-5 h-5 rounded-full bg-destructive text-destructive-foreground">
            <X className="h-3 w-3" />
          </div>
          <span className="text-xs font-medium text-destructive">
            {step.label}
          </span>
          {step.timestamp && (
            <span className="text-[10px] text-muted-foreground ml-auto">
              {new Date(step.timestamp).toLocaleDateString()}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
