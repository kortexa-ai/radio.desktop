import { useCallback, useRef, useState } from "react";

interface RotaryKnobProps {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    color?: string;
    onChange: (value: number) => void;
    formatValue?: (value: number) => string;
}

export default function RotaryKnob({
    label,
    value,
    min,
    max,
    step = 1,
    color = "#8b5cf6",
    onChange,
    formatValue,
}: RotaryKnobProps) {
    const knobRef = useRef<SVGSVGElement>(null);
    const [dragging, setDragging] = useState(false);
    const startY = useRef(0);
    const startValue = useRef(0);

    const size = 90;
    const cx = size / 2;
    const cy = size / 2;
    const radius = 34;

    // Arc goes from 135° to 405° (270° sweep)
    const startAngle = 135;
    const endAngle = 405;
    const sweepAngle = endAngle - startAngle;

    const fraction = (value - min) / (max - min);
    const currentAngle = startAngle + fraction * sweepAngle;

    // Convert angle to SVG arc path
    const polarToCartesian = (angle: number) => {
        const rad = ((angle - 90) * Math.PI) / 180;
        return {
            x: cx + radius * Math.cos(rad),
            y: cy + radius * Math.sin(rad),
        };
    };

    const describeArc = (start: number, end: number) => {
        const s = polarToCartesian(start);
        const e = polarToCartesian(end);
        const largeArc = end - start > 180 ? 1 : 0;
        return `M ${s.x} ${s.y} A ${radius} ${radius} 0 ${largeArc} 1 ${e.x} ${e.y}`;
    };

    // Indicator line from center toward edge
    const indicatorEnd = polarToCartesian(currentAngle);
    const indicatorStart = {
        x: cx + (radius - 16) * Math.cos(((currentAngle - 90) * Math.PI) / 180),
        y: cy + (radius - 16) * Math.sin(((currentAngle - 90) * Math.PI) / 180),
    };

    const handleMouseDown = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            setDragging(true);
            startY.current = e.clientY;
            startValue.current = value;

            const handleMouseMove = (ev: MouseEvent) => {
                const dy = startY.current - ev.clientY;
                const range = max - min;
                const sensitivity = range / 150; // 150px drag = full range
                let newValue = startValue.current + dy * sensitivity;
                newValue = Math.round(newValue / step) * step;
                newValue = Math.max(min, Math.min(max, newValue));
                onChange(newValue);
            };

            const handleMouseUp = () => {
                setDragging(false);
                window.removeEventListener("mousemove", handleMouseMove);
                window.removeEventListener("mouseup", handleMouseUp);
            };

            window.addEventListener("mousemove", handleMouseMove);
            window.addEventListener("mouseup", handleMouseUp);
        },
        [value, min, max, step, onChange],
    );

    const handleWheel = useCallback(
        (e: React.WheelEvent) => {
            const direction = e.deltaY < 0 ? 1 : -1;
            let newValue = value + direction * step;
            newValue = Math.max(min, Math.min(max, newValue));
            onChange(newValue);
        },
        [value, min, max, step, onChange],
    );

    const displayValue = formatValue ? formatValue(value) : value.toString();

    return (
        <div className="flex flex-col items-center gap-1 select-none">
            <svg
                ref={knobRef}
                width={size}
                height={size}
                className="cursor-pointer"
                onMouseDown={handleMouseDown}
                onWheel={handleWheel}
            >
                {/* Background track */}
                <path
                    d={describeArc(startAngle, endAngle)}
                    className="knob-track"
                />
                {/* Value arc */}
                {fraction > 0.005 && (
                    <path
                        d={describeArc(startAngle, currentAngle)}
                        className="knob-value"
                        stroke={color}
                    />
                )}
                {/* Knob body */}
                <circle
                    cx={cx}
                    cy={cy}
                    r={radius - 8}
                    className="knob-body"
                    style={{
                        filter: dragging ? `drop-shadow(0 0 8px ${color}40)` : undefined,
                    }}
                />
                {/* Indicator line */}
                <line
                    x1={indicatorStart.x}
                    y1={indicatorStart.y}
                    x2={indicatorEnd.x}
                    y2={indicatorEnd.y}
                    className="knob-indicator"
                    stroke={color}
                />
            </svg>
            <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                {label}
            </div>
            <div className="text-sm font-bold" style={{ color }}>
                {displayValue}
            </div>
        </div>
    );
}
