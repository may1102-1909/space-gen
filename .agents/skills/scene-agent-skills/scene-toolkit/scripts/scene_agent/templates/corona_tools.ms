/* Scene Agent Skills 0.1.0 | MIT | definitions only on fileIn.
   Tested host details live in docs/verification.md. Capability checks precede changes.
   Call saUseCorona() explicitly to switch a scene's render engine. */
global saCoronaToolsVersion = "0.1.0"

fn saRequireProperty obj prop = (
    if not isProperty obj prop do throw ("Scene Agent: unsupported property " + prop as string)
)
fn saRequireCorona = (
    local r = renderers.current
    if not matchPattern ((classof r) as string) pattern:"*Corona*" ignoreCase:true do
        throw "Scene Agent: active renderer is not Corona. Call saUseCorona() to switch explicitly."
    r
)
fn saUseCorona = (
    local r = try(CoronaRenderer())catch(undefined)
    if r == undefined do throw "Scene Agent: Corona renderer plugin is unavailable."
    renderers.current = r
    r
)
fn saQuality mode = (
    local r = saRequireCorona()
    local passes, noise, displacement
    case mode of (
        #preview: (passes=16; noise=8.0; displacement=4.0)
        #review:  (passes=64; noise=4.0; displacement=2.0)
        #final:   (passes=160; noise=2.0; displacement=1.0)
        default: throw "Scene Agent: use #preview, #review or #final."
    )
    for p in #(#progressive_passLimit,#progressive_timeLimit,#adaptivity_targetError,#geometry_displace_maxSizeScreen) do saRequireProperty r p
    r.progressive_passLimit=passes
    r.progressive_timeLimit=0
    r.adaptivity_targetError=noise
    r.geometry_displace_maxSizeScreen=displacement
    format "Scene Agent: %; pass cap %, noise target %. Neither guarantees convergence.\n" mode passes noise
    r
)
fn saPhysical name base roughness:0.6 metal:false ior:1.5 = (
    if roughness < 0 or roughness > 1 do throw "Roughness must be 0..1."
    if ior < 1 do throw "IOR must be >=1."
    local m=try(CoronaPhysicalMtl())catch(undefined)
    if m == undefined do throw "Corona Physical Material is unavailable."
    for p in #(#baseColor,#baseRoughness,#roughnessMode,#metalnessMode,#baseIor) do saRequireProperty m p
    m.name=name; m.baseColor=base; m.baseRoughness=roughness
    m.roughnessMode=0; m.metalnessMode=if metal then 1 else 0; m.baseIor=ior
    m
)
fn saGlass name = (
    local m=saPhysical name (color 255 255 255) roughness:0.02 ior:1.52
    saRequireProperty m #refractionAmount
    saRequireProperty m #useThinMode
    m.refractionAmount=1.0; m.useThinMode=false
    m
)
fn saDisplacement material texture minimumMM maximumMM = (
    if maximumMM < minimumMM do throw "Displacement bounds are reversed."
    for p in #(#displacementTexmap,#displacementTexmapOn,#displacementMinimum,#displacementMaximum) do saRequireProperty material p
    local mm=units.decodeValue "1mm"
    material.displacementTexmap=texture; material.displacementTexmapOn=true
    material.displacementMinimum=minimumMM*mm; material.displacementMaximum=maximumMM*mm
    material
)
fn saAim node target = (
    if distance node.pos target < 0.0001 do throw "Aim target equals node position."
    local z=normalize(node.pos-target)
    local x=cross [0,0,1] z
    if length x < 0.001 do x=cross [0,1,0] z
    x=normalize x
    local y=normalize(cross z x)
    node.transform=matrix3 x y z node.pos
    node
)
fn saAreaLight name position target widthM heightM intensity:5.0 kelvin:3000 = (
    if widthM <= 0 or heightM <= 0 or intensity < 0 do throw "Invalid light size/intensity."
    local o=try(CoronaLight())catch(undefined)
    if o==undefined do throw "Corona Light is unavailable."
    local metre=units.decodeValue "1m"
    o.name=name; o.pos=position; o.shape=1; o.width=widthM*metre; o.height=heightM*metre
    o.intensityUnits=0; o.intensity=intensity; o.colorMode=1; o.blackbodyTemp=kelvin
    o.visibleDirectly=false
    saAim o target
)
fn saLightMix groups = (
    saRequireCorona()
    local mgr=maxOps.GetCurRenderElementMgr()
    for i=0 to mgr.NumRenderElements()-1 do (
        local e=mgr.GetRenderElement i
        if matchPattern e.elementName pattern:"SA | *" do throw "Scene Agent LightMix already exists; edit its groups instead of duplicating."
    )
    -- Validate all requested nodes before adding any render elements.
    for g in groups do (
        if g.count != 2 do throw "Use #(#(groupName, #(nodes)), ...)."
        for n in g[2] do if not isValidNode n do throw "Invalid LightMix node."
    )
    local env=CShading_LightSelect()
    env.elementName="SA | Environment"; env.addEnvironment=true; env.useDenoise=true
    mgr.AddRenderElement env
    for g in groups do (
        local e=CShading_LightSelect()
        e.elementName="SA | " + g[1]; e.includedNodes=g[2]; e.addEnvironment=false; e.useDenoise=true
        mgr.AddRenderElement e
    )
    local mix=CShading_LightMix(); mix.elementName="SA | LightMix"; mgr.AddRenderElement mix
    mgr.SetElementsActive true
    -- Existing AOVs and existing LightMix intensity arrays remain untouched.
    mgr.NumRenderElements()
)
fn saMeshAudit nodes = (
    local result=#()
    for n in nodes where superclassof n == GeometryClass do (
        local meshValue=try(snapshotAsMesh n)catch(undefined)
        if meshValue != undefined do (
            local openCount=try((meshop.getOpenEdges meshValue).numberSet)catch(-1)
            local uv=try(meshop.getMapSupport meshValue 1)catch(false)
            append result #(n.name, meshValue.numverts, meshValue.numfaces, openCount, uv)
            free meshValue
        )
    )
    result -- name, vertices, triangles, open edges (-1 unavailable), UV channel 1
)
