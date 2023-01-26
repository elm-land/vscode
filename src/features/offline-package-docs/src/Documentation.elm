module Documentation exposing
    ( Documentation
    , decoder
    , fromJson
    , toListOfItems
    )

import Json.Decode


type alias Documentation =
    { modules : List Module
    }


toListOfItems : Module -> List String
toListOfItems module_ =
    module_.comment
        |> String.lines
        |> List.filter (String.startsWith "@docs")
        |> List.map (String.dropLeft (String.length "@docs "))
        |> List.concatMap (String.split ", ")



-- DECODING FROM JSON


fromJson : Json.Decode.Value -> Maybe Documentation
fromJson json =
    case Json.Decode.decodeValue decoder json of
        Ok docs ->
            Just docs

        Err reason ->
            let
                _ =
                    Debug.log "reason" reason
            in
            Nothing


decoder : Json.Decode.Decoder Documentation
decoder =
    Json.Decode.map Documentation
        (Json.Decode.list moduleDecoder)


type alias Module =
    { name : String
    , comment : String
    , aliases : List Alias
    , binops : List Binop
    , unions : List Union
    , values : List Value
    }


moduleDecoder : Json.Decode.Decoder Module
moduleDecoder =
    Json.Decode.map6 Module
        (Json.Decode.field "name" Json.Decode.string)
        (Json.Decode.field "comment" Json.Decode.string)
        (Json.Decode.field "aliases" (Json.Decode.list aliasDecoder))
        (Json.Decode.field "binops" (Json.Decode.list binopDecoder))
        (Json.Decode.field "unions" (Json.Decode.list unionDecoder))
        (Json.Decode.field "values" (Json.Decode.list valueDecoder))


type alias Alias =
    { name : String }


aliasDecoder : Json.Decode.Decoder Alias
aliasDecoder =
    Json.Decode.map Alias
        (Json.Decode.field "name" Json.Decode.string)


type alias Binop =
    { name : String }


binopDecoder : Json.Decode.Decoder Binop
binopDecoder =
    Json.Decode.map Binop
        (Json.Decode.field "name" Json.Decode.string)


type alias Union =
    { name : String }


unionDecoder : Json.Decode.Decoder Union
unionDecoder =
    Json.Decode.map Union
        (Json.Decode.field "name" Json.Decode.string)


type alias Value =
    { name : String }


valueDecoder : Json.Decode.Decoder Value
valueDecoder =
    Json.Decode.map Value
        (Json.Decode.field "name" Json.Decode.string)
