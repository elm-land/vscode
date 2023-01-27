module Documentation exposing
    ( Documentation, fromJson
    , findModuleWithName
    , Module
    , findAliasWithName, findBinopWithName, findUnionWithName, findValueWithName
    , Alias, Binop, Union, Value
    )

{-|

@docs Documentation, fromJson
@docs findModuleWithName

@docs Module

@docs findAliasWithName, findBinopWithName, findUnionWithName, findValueWithName

@docs Alias, Binop, Union, Value

-}

import Elm.Docs
import Json.Decode



-- DOCUMENTATION


type alias Documentation =
    { modules : List Module
    }


findModuleWithName : String -> Documentation -> Maybe Module
findModuleWithName name docs =
    docs.modules
        |> List.filter (\mod -> mod.name == name)
        |> List.head


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
        (Json.Decode.list Elm.Docs.decoder)



-- MODULE


type alias Module =
    Elm.Docs.Module


findAliasWithName : String -> Module -> Maybe Alias
findAliasWithName name module_ =
    module_.aliases
        |> List.filter (.name >> (==) name)
        |> List.head


findBinopWithName : String -> Module -> Maybe Binop
findBinopWithName name module_ =
    module_.binops
        |> List.filter (.name >> (==) name)
        |> List.head


findUnionWithName : String -> Module -> Maybe Union
findUnionWithName name module_ =
    module_.unions
        |> List.filter (.name >> (==) name)
        |> List.head


findValueWithName : String -> Module -> Maybe Value
findValueWithName name module_ =
    module_.values
        |> List.filter (.name >> (==) name)
        |> List.head



-- ALIAS


type alias Alias =
    Elm.Docs.Alias



-- BINOP


type alias Binop =
    Elm.Docs.Binop



-- UNION


type alias Union =
    Elm.Docs.Union



-- VALUE


type alias Value =
    Elm.Docs.Value
