import React from 'react';

type StarBorderProps<T extends React.ElementType> = React.ComponentPropsWithoutRef<T> & {
  as?: T;
  className?: string;
  children?: React.ReactNode;
  color?: string;
  speed?: React.CSSProperties['animationDuration'];
  thickness?: number;
  isAnimate?: boolean;
};

/**
 * StarBorder component that creates a moving star effect on the borders.
 * Uses radial gradients that move along the edges via CSS animations.
 */
export function StarBorder<T extends React.ElementType = 'div'>({
  as,
  className = '',
  color = '#c5a059',
  speed = '3s',
  thickness = 2,
  isAnimate = true,
  children,
  ...rest
}: StarBorderProps<T>) {
  const Component = as || 'div';

  return (
    <Component
      className={`relative inline-block overflow-hidden rounded-[20px] ${className}`}
      {...(rest as any)}
      style={{
        padding: `${thickness}px`,
        ...(rest as any).style
      }}
    >
      {/* Bottom Star Movement */}
      <div
        className={`absolute w-[300%] h-[50%] opacity-70 bottom-[-11px] right-[-250%] rounded-full z-0 ${isAnimate ? 'animate-star-movement-bottom' : ''}`}
        style={{
          background: `radial-gradient(circle, ${color}, transparent 10%)`,
          ...(isAnimate && { animationDuration: speed })
        }}
      />
      {/* Top Star Movement */}
      <div
        className={`absolute w-[300%] h-[50%] opacity-70 top-[-10px] left-[-250%] rounded-full z-0 ${isAnimate ? 'animate-star-movement-top' : ''}`}
        style={{
          background: `radial-gradient(circle, ${color}, transparent 10%)`,
          ...(isAnimate && { animationDuration: speed })
        }}
      />
      {/* Content Container - Uses inherit to maintain parent background style or specified classes */}
      <div className="relative z-[1] w-full h-full rounded-[inherit]">
        {children}
      </div>
    </Component>
  );
}
