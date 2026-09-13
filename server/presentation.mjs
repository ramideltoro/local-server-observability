// Complete native panel options are required by Grafana's scene renderer; an empty
// legend placement can leave a valid data frame with a zero-sized plotting area.
export function presentation(type, unit = "short") {
  const fieldConfig = {
    defaults: {
      unit,
      noValue: "No samples in the selected interval",
      color: { mode: "fixed", fixedColor: "#efb04f" },
      custom: {
        axisCenteredZero: false,
        axisLabel: "",
        axisPlacement: "auto",
        barAlignment: 0,
        drawStyle: "line",
        fillOpacity: 10,
        gradientMode: "none",
        lineInterpolation: "linear",
        lineWidth: 1,
        pointSize: 5,
        showPoints: "never",
        spanNulls: false,
        stacking: { group: "A", mode: "none" },
        thresholdsStyle: { mode: "off" },
      },
      mappings: [],
    },
    overrides: [],
  };
  const options =
    type === "timeseries"
      ? {
          legend: {
            calcs: [],
            displayMode: "list",
            placement: "bottom",
            showLegend: false,
          },
          tooltip: { mode: "single", sort: "none" },
        }
      : type === "table"
        ? {
            showHeader: true,
            cellHeight: "sm",
            footer: { show: false, reducer: ["sum"], fields: "" },
          }
        : {
            reduceOptions: {
              calcs: ["lastNotNull"],
              fields: "",
              values: false,
            },
            orientation: "auto",
            textMode: "auto",
            colorMode: "value",
            graphMode: "area",
            justifyMode: "auto",
            showThresholdLabels: false,
            showThresholdMarkers: true,
            displayMode: "gradient",
          };
  return { fieldConfig, options };
}
